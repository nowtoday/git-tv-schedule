import csv
import json
import os
import re
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent.parent
SCHEDULE_PATH = ROOT / "schedule.json"
SHEET_ID = "1D9jF3KVYAZBvYRDMzZ8oEnGwVojanrIW7FQFl4n2TOk"
SHEET_GIDS = ("0", "48397256", "278462282")
DAYS = ("월", "화", "수", "목", "금", "토", "일")
PROGRAM_MARKER = re.compile(
    r"(?:HD방송|UHD방송|자막방송|화면해설|한국수어방송|재방송|생방송)\s*(\d{2})"
)
PROGRAM_METADATA = re.compile(
    r"프로그램등급\s*\d+세|재방송|생방송|HD방송|UHD방송|자막방송|화면해설|한국수어방송"
)


def fetch_sheet(gid):
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={gid}"
    request = Request(url, headers={"User-Agent": "git-tv-schedule/1.0"})
    with urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise RuntimeError(f"시트 {gid}에서 HTTP {response.status} 응답")
        return response.read().decode("utf-8-sig")


def extract_metadata(program_text):
    age_rating = re.search(r"프로그램등급\s*(\d{1,2})세", program_text)
    quality = "UHD" if "UHD방송" in program_text else "HD" if "HD방송" in program_text else None
    return {
        "videoQuality": quality,
        "isLive": "생방송" in program_text,
        "isRerun": "재방송" in program_text,
        "hasSubtitles": "자막방송" in program_text,
        "hasAudioDescription": "화면해설" in program_text,
        "hasKoreanSignLanguage": "한국수어방송" in program_text,
        "ageRating": int(age_rating.group(1)) if age_rating else None,
    }


def parse_cell(cell):
    starts = []
    first = re.match(r"^(\d{2})(?=.)", cell)
    if first and int(first.group(1)) < 60:
        starts.append((0, first.group(1)))

    for match in PROGRAM_MARKER.finditer(cell):
        minute = match.group(1)
        if int(minute) < 60:
            starts.append((match.start() + match.group(0).rfind(minute), minute))

    programs = []
    for index, (start, minute) in enumerate(starts):
        end = starts[index + 1][0] if index + 1 < len(starts) else len(cell)
        program_text = cell[start + 2 : end]
        metadata = extract_metadata(program_text)
        title = PROGRAM_METADATA.sub(" ", program_text)
        title = " ".join(title.split())
        if title:
            programs.append((minute, title, metadata))
    return programs


def parse_sheet(text, day):
    rows = list(csv.reader(text.splitlines()))
    if len(rows) < 3 or not rows[0] or rows[0][0].lstrip("\ufeff") != "채널":
        raise ValueError("Google Sheets 편성표의 표 구조가 올바르지 않습니다.")
    if not rows[1] or rows[1][0] != "시간":
        raise ValueError("Google Sheets 편성표에 시간 헤더가 없습니다.")

    programs = []
    for row in rows[2:]:
        hour_match = re.match(r"^(\d{1,2})시", row[0] if row else "")
        if not hour_match:
            continue
        hour = int(hour_match.group(1))
        if hour > 23:
            continue

        for index, cell in enumerate(row[1:]):
            channel = rows[0][index + 1] if index + 1 < len(rows[0]) else ""
            if (
                not channel
                or not cell.strip()
                or "방송 시간이 아닙니다" in cell
                or "방송시간이 아닙니다" in cell
            ):
                continue

            for minute, title, metadata in parse_cell(cell):
                programs.append(
                    {
                        "day": day,
                        "time": f"{hour:02d}:{minute}",
                        "channel": channel.strip(),
                        "title": title,
                        "metadata": metadata,
                    }
                )
    return programs


def validate_previous_schedule(value):
    if not isinstance(value, dict) or value.get("version") != 1:
        return []
    programs = value.get("programs")
    if not isinstance(programs, list):
        return []
    return [
        program
        for program in programs
        if isinstance(program, dict)
        and program.get("day") in DAYS
        and isinstance(program.get("time"), str)
        and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", program["time"])
        and isinstance(program.get("channel"), str)
        and program["channel"].strip()
        and isinstance(program.get("title"), str)
        and program["title"].strip()
    ]


def merge_schedule(previous, todays_programs, day):
    accumulated = [
        program
        for program in validate_previous_schedule(previous)
        if program["day"] != day
    ]
    accumulated.extend(todays_programs)
    day_order = {name: index for index, name in enumerate(DAYS)}
    accumulated.sort(
        key=lambda program: (
            day_order[program["day"]],
            program["time"],
            program["channel"],
            program["title"],
        )
    )
    return accumulated


def updated_day_timestamps(previous, programs, day, refreshed_at):
    previous_updated_at = previous.get("updatedAtByDay", {})
    if not isinstance(previous_updated_at, dict):
        previous_updated_at = {}
    timestamps = {
        name: previous_updated_at.get(name, previous.get("generatedAt"))
        for name in DAYS
        if any(program["day"] == name for program in programs)
        and isinstance(previous_updated_at.get(name, previous.get("generatedAt")), str)
    }
    timestamps[day] = refreshed_at
    return timestamps


def day_updated_today(previous, day, today):
    day_timestamps = previous.get("updatedAtByDay", {})
    updated_at = day_timestamps.get(day) if isinstance(day_timestamps, dict) else None
    if updated_at is None:
        updated_at = previous.get("generatedAt")
    if not isinstance(updated_at, str):
        return False

    timestamp = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError(f"{day}요일 갱신 시각에 시간대 정보가 없습니다.")
    return timestamp.astimezone(ZoneInfo("Asia/Seoul")).date() == today


def should_skip_scheduled_refresh(previous, day, today, event_name):
    return event_name == "schedule" and day_updated_today(previous, day, today)


def write_schedule(programs, updated_at_by_day, generated_at):
    schedule = {
        "version": 1,
        "generatedAt": generated_at,
        "updatedAtByDay": updated_at_by_day,
        "programs": programs,
    }
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=ROOT, delete=False, newline="\n"
    ) as temporary:
        json.dump(schedule, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(SCHEDULE_PATH)


def main():
    now_korea = datetime.now(ZoneInfo("Asia/Seoul"))
    day_index = now_korea.weekday()
    day = DAYS[day_index]
    try:
        previous = json.loads(SCHEDULE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        previous = {}

    if should_skip_scheduled_refresh(
        previous, day, now_korea.date(), os.environ.get("GITHUB_EVENT_NAME")
    ):
        print(f"{day}요일 편성이 오늘 이미 갱신되어 있어 이번 예약 실행은 건너뜁니다.")
        return

    todays_programs = []
    for gid in SHEET_GIDS:
        todays_programs.extend(parse_sheet(fetch_sheet(gid), day))
    if not todays_programs:
        raise RuntimeError(f"Google Sheets에서 {day}요일 편성을 찾지 못했습니다.")

    accumulated = merge_schedule(previous, todays_programs, day)
    refreshed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    updated_at_by_day = updated_day_timestamps(previous, accumulated, day, refreshed_at)
    write_schedule(accumulated, updated_at_by_day, refreshed_at)
    print(f"요일별 갱신: {day} {refreshed_at}")
    print(f"갱신 완료: {day}요일 {len(todays_programs)}개, 주간 누적 {len(accumulated)}개")


if __name__ == "__main__":
    main()
