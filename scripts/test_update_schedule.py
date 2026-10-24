import unittest

from scripts.update_schedule import merge_schedule, parse_cell, parse_sheet, updated_day_timestamps


class ScheduleParserTests(unittest.TestCase):
    def test_parse_cell_splits_multiple_programs_and_metadata(self):
        programs = parse_cell("05첫 프로그램 HD방송25두 번째 프로그램")

        self.assertEqual(
            programs,
            [("05", "첫 프로그램"), ("25", "두 번째 프로그램")],
        )

    def test_parse_sheet_maps_channel_and_hour(self):
        sheet = "채널,KBS1,MBC\n시간,,\n20시,05첫 프로그램,방송 시간이 아닙니다\n"

        programs = parse_sheet(sheet, "토")

        self.assertEqual(
            programs,
            [
                {
                    "day": "토",
                    "time": "20:05",
                    "channel": "KBS1",
                    "title": "첫 프로그램",
                }
            ],
        )

    def test_merge_replaces_only_matching_weekday(self):
        previous = {
            "version": 1,
            "programs": [
                {"day": "월", "time": "20:00", "channel": "KBS1", "title": "월요일"},
                {"day": "토", "time": "20:00", "channel": "KBS1", "title": "오래된 토요일"},
            ],
        }
        todays_programs = [
            {"day": "토", "time": "21:00", "channel": "KBS1", "title": "새 토요일"}
        ]

        merged = merge_schedule(previous, todays_programs, "토")

        self.assertEqual([program["title"] for program in merged], ["월요일", "새 토요일"])

    def test_refresh_timestamp_only_advances_refreshed_day(self):
        previous = {
            "generatedAt": "2026-10-23T18:00:00Z",
            "updatedAtByDay": {"월": "2026-10-20T18:00:00Z"},
        }
        programs = [
            {"day": "월", "time": "20:00", "channel": "KBS1", "title": "월요일"},
            {"day": "토", "time": "20:00", "channel": "KBS1", "title": "토요일"},
        ]

        timestamps = updated_day_timestamps(previous, programs, "토", "2026-10-24T18:00:00Z")

        self.assertEqual(timestamps["월"], "2026-10-20T18:00:00Z")
        self.assertEqual(timestamps["토"], "2026-10-24T18:00:00Z")

    def test_legacy_schedule_uses_global_timestamp_for_existing_days(self):
        previous = {"generatedAt": "2026-10-23T18:00:00Z"}
        programs = [
            {"day": "월", "time": "20:00", "channel": "KBS1", "title": "월요일"},
            {"day": "토", "time": "20:00", "channel": "KBS1", "title": "토요일"},
        ]

        timestamps = updated_day_timestamps(previous, programs, "토", "2026-10-24T18:00:00Z")

        self.assertEqual(timestamps["월"], "2026-10-23T18:00:00Z")
        self.assertEqual(timestamps["토"], "2026-10-24T18:00:00Z")


if __name__ == "__main__":
    unittest.main()
