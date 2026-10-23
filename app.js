const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const STORAGE_KEY = "my-tv-guide-schedule-v1";
const FAVORITES_KEY = "my-tv-guide-favorites-v1";
const FAVORITES_COOKIE_MAX_LENGTH = 3800;
const FAVORITES_BACKUP_VERSION = 1;
const GENRES = ["미분류", "예능", "교양/다큐", "드라마"];
const GENRE_SETTINGS_URL = new URL("genres.json", document.baseURI);
const SHEET_ID = "1D9jF3KVYAZBvYRDMzZ8oEnGwVojanrIW7FQFl4n2TOk";
const SHEET_TABS = [
  { gid: "0" },
  { gid: "48397256" },
  { gid: "278462282" },
];

const scheduleElement = document.querySelector("#schedule");
const dayFilters = document.querySelector("#day-filters");
const genreFilter = document.querySelector("#genre-filter");
const channelFilter = document.querySelector("#channel-filter");
const statusElement = document.querySelector("#status");
const csvFileInput = document.querySelector("#csv-file");
const favoriteListElement = document.querySelector("#favorite-list");
const favoriteInput = document.querySelector("#favorite-input");
const viewFilters = document.querySelector("#view-filters");
const favoritesFileInput = document.querySelector("#favorites-file");
let selectedDay = "";
let classifications = {};
let hasImportedSchedule = false;
let programs = loadPrograms();
let favorites = loadFavorites();
let viewMode = favorites.length ? "favorites" : "all";

function loadPrograms() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const imported = validatePrograms(JSON.parse(saved));
    hasImportedSchedule = true;
    return imported;
  } catch (error) {
    console.error("저장된 편성표를 불러오지 못했습니다.", error);
    statusElement.textContent = "저장된 편성표를 불러오지 못했습니다. CSV를 다시 가져와 주세요.";
    return [];
  }
}

function loadFavorites() {
  try {
    const cookieValue = readCookie(FAVORITES_KEY);
    if (cookieValue !== null) return validateFavorites(JSON.parse(cookieValue));

    const legacyValue = localStorage.getItem(FAVORITES_KEY);
    if (legacyValue) {
      const migrated = validateFavorites(JSON.parse(legacyValue));
      writeFavoritesCookie(migrated);
      localStorage.removeItem(FAVORITES_KEY);
      return migrated;
    }
    return [];
  } catch (error) {
    console.error("즐겨찾기를 불러오지 못했습니다.", error);
    statusElement.textContent = `즐겨찾기를 불러오지 못했습니다: ${error.message}`;
    return [];
  }
}

function validateFavorites(value) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 80)
  ) {
    throw new Error("즐겨찾기 백업 형식이 올바르지 않습니다.");
  }
  return [...new Set(value.map((item) => item.trim()))];
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split("; ").find((cookie) => cookie.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

function writeFavoritesCookie(nextFavorites) {
  const serialized = JSON.stringify(nextFavorites);
  const encodedValue = encodeURIComponent(serialized);
  if (encodedValue.length > FAVORITES_COOKIE_MAX_LENGTH) {
    throw new Error("쿠키 저장 한도를 넘었습니다. 즐겨찾기 수를 줄이거나 백업 파일을 이용해 주세요.");
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(FAVORITES_KEY)}=${encodedValue}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  if (readCookie(FAVORITES_KEY) !== serialized) {
    throw new Error("브라우저가 쿠키 저장을 허용하지 않았습니다. 사이트 쿠키 설정을 확인해 주세요.");
  }
}

function validatePrograms(value) {
  if (!Array.isArray(value)) {
    throw new Error("편성표 데이터가 배열 형식이 아닙니다.");
  }

  return value.map((program, index) => {
    if (
      !program ||
      !DAYS.includes(program.day) ||
      !/^\d{2}:\d{2}$/.test(program.time) ||
      Number(program.time.slice(0, 2)) > 23 ||
      Number(program.time.slice(3, 5)) > 59 ||
      !["channel", "title"].every((key) => typeof program[key] === "string" && program[key].trim())
    ) {
      throw new Error(`${index + 1}번째 방송 정보의 형식이 올바르지 않습니다.`);
    }
    const title = program.title.trim();
    return {
      day: program.day,
      time: program.time,
      channel: program.channel.trim(),
      genre: genreFor(title),
      title,
    };
  });
}

function normalizeTitle(title) {
  return title.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

function genreFor(title) {
  const normalizedTitle = normalizeTitle(title);
  const match = Object.keys(classifications)
    .filter((name) => normalizedTitle.includes(name))
    .sort((a, b) => b.length - a.length)[0];
  return match ? classifications[match] : "미분류";
}

function validateClassifications(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("genres.json은 classifications 객체를 포함해야 합니다.");
  }

  const entries = Object.entries(value).map(([title, genre]) => {
    if (!title.trim() || !GENRES.includes(genre) || genre === "미분류") {
      throw new Error(`장르 설정이 올바르지 않습니다: ${title}`);
    }
    return [normalizeTitle(title), genre];
  });
  return Object.fromEntries(entries);
}

async function loadClassifications() {
  try {
    const response = await fetch(GENRE_SETTINGS_URL, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const settings = await response.json();
    if (!settings || settings.version !== 1) {
      throw new Error("지원하지 않는 genres.json 형식입니다.");
    }

    classifications = validateClassifications(settings.classifications);
    programs = validatePrograms(programs);
    render();
    statusElement.textContent = `${Object.keys(classifications).length}개 프로그램 장르 설정을 적용했습니다.`;
  } catch (error) {
    console.error("GitHub 장르 설정을 불러오지 못했습니다.", error);
    classifications = {};
    programs = validatePrograms(programs);
    render();
    statusElement.textContent = "GitHub 장르 설정을 읽지 못해 프로그램을 미분류로 표시합니다.";
  }
}

function matchingFavorite(title) {
  const normalizedTitle = normalizeTitle(title);
  return favorites.find((favorite) => normalizedTitle.includes(normalizeTitle(favorite)));
}

function savePrograms(nextPrograms) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPrograms));
    hasImportedSchedule = true;
    programs = nextPrograms;
    statusElement.textContent = `${programs.length}개 프로그램을 이 브라우저에 저장했습니다.`;
    render();
  } catch (error) {
    console.error("편성표를 저장하지 못했습니다.", error);
    statusElement.textContent = "편성표를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.";
  }
}

function saveFavorites(nextFavorites) {
  try {
    const validated = validateFavorites(nextFavorites);
    writeFavoritesCookie(validated);
    favorites = validated;
    viewMode = favorites.length ? "favorites" : "all";
    statusElement.textContent = `${favorites.length}개 프로그램을 쿠키에 저장했습니다.`;
    render();
  } catch (error) {
    console.error("즐겨찾기를 저장하지 못했습니다.", error);
    statusElement.textContent = `즐겨찾기를 저장하지 못했습니다: ${error.message}`;
  }
}

function downloadFavoritesBackup() {
  const backup = {
    version: FAVORITES_BACKUP_VERSION,
    favorites,
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tv-favorites-backup.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  statusElement.textContent = `${favorites.length}개 즐겨찾기를 백업 파일로 저장했습니다.`;
}

function renderFavorites() {
  favoriteListElement.replaceChildren();
  if (!favorites.length) {
    const empty = document.createElement("p");
    empty.className = "favorite-empty";
    empty.textContent = "아직 등록된 프로그램이 없습니다. 편성표의 별표를 누르거나 이름을 입력해 추가하세요.";
    favoriteListElement.append(empty);
  } else {
    favorites.forEach((favorite) => {
      const chip = document.createElement("span");
      chip.className = "favorite-chip";
      const name = document.createElement("span");
      name.textContent = favorite;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "favorite-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${favorite} 즐겨찾기 삭제`);
      remove.addEventListener("click", () => {
        saveFavorites(favorites.filter((item) => item !== favorite));
      });
      chip.append(name, remove);
      favoriteListElement.append(chip);
    });
  }

  const suggestions = document.querySelector("#program-suggestions");
  suggestions.replaceChildren();
  [...new Set(programs.map((program) => program.title))].forEach((title) => {
    suggestions.append(new Option(title, title));
  });
}

function renderDayFilters() {
  dayFilters.replaceChildren();
  [["", "전체"], ...DAYS.map((day) => [day, day])].forEach(([day, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(selectedDay === day));
    button.addEventListener("click", () => {
      selectedDay = day;
      renderDayFilters();
      renderSchedule();
    });
    dayFilters.append(button);
  });
}

function renderViewFilters() {
  viewFilters.replaceChildren();
  [
    ["favorites", "즐겨찾기"],
    ["all", "전체 보기"],
  ].forEach(([mode, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(viewMode === mode));
    button.disabled = mode === "favorites" && !favorites.length;
    button.addEventListener("click", () => {
      viewMode = mode;
      renderViewFilters();
      renderSchedule();
    });
    viewFilters.append(button);
  });
}

function renderChannelOptions() {
  const currentValue = channelFilter.value;
  const channels = [...new Set(programs.map((program) => program.channel))].sort((a, b) => a.localeCompare(b, "ko"));
  channelFilter.replaceChildren(new Option("모든 채널", ""));
  channels.forEach((channel) => channelFilter.add(new Option(channel, channel)));
  channelFilter.value = channels.includes(currentValue) ? currentValue : "";
}

function renderSchedule() {
  const filtered = programs.filter((program) => (
    (!selectedDay || program.day === selectedDay) &&
    (!genreFilter.value || program.genre === genreFilter.value) &&
    (!channelFilter.value || program.channel === channelFilter.value) &&
    (viewMode !== "favorites" || Boolean(matchingFavorite(program.title)))
  ));
  const days = selectedDay ? [selectedDay] : DAYS;

  scheduleElement.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = viewMode === "favorites"
      ? "즐겨찾기한 프로그램의 편성이 없습니다. 전체 보기에서 프로그램을 찾아 별표를 눌러 추가하세요."
      : "표시할 편성 정보가 없습니다. CSV 파일을 가져와 편성표를 채워보세요.";
    scheduleElement.append(empty);
    return;
  }

  days.forEach((day) => {
    const dayPrograms = filtered
      .filter((program) => program.day === day)
      .sort((a, b) => a.time.localeCompare(b.time));
    if (!dayPrograms.length) return;

    const card = document.createElement("article");
    card.className = "day-card";
    const heading = document.createElement("header");
    heading.className = "day-heading";
    const title = document.createElement("h2");
    title.textContent = `${day}요일`;
    const count = document.createElement("span");
    count.textContent = `${dayPrograms.length}개 프로그램`;
    heading.append(title, count);

    const list = document.createElement("ul");
    list.className = "program-list";
    dayPrograms.forEach((program) => {
      const item = document.createElement("li");
      item.className = "program";
      const time = document.createElement("time");
      time.className = "time";
      time.textContent = program.time;
      const details = document.createElement("div");
      const titleRow = document.createElement("div");
      titleRow.className = "program-title-row";
      const programTitle = document.createElement("p");
      programTitle.className = "program-title";
      programTitle.textContent = program.title;
      const favorite = matchingFavorite(program.title);
      const favoriteButton = document.createElement("button");
      favoriteButton.type = "button";
      favoriteButton.className = "favorite-toggle";
      favoriteButton.textContent = favorite ? "★" : "☆";
      favoriteButton.setAttribute("aria-pressed", String(Boolean(favorite)));
      favoriteButton.setAttribute(
        "aria-label",
        favorite ? `${favorite} 즐겨찾기 해제` : `${program.title} 즐겨찾기에 추가`,
      );
      favoriteButton.addEventListener("click", () => {
        if (favorite) {
          saveFavorites(favorites.filter((item) => item !== favorite));
        } else {
          saveFavorites([...favorites, program.title]);
        }
      });
      titleRow.append(programTitle, favoriteButton);
      const meta = document.createElement("div");
      meta.className = "program-meta";
      const genre = document.createElement("span");
      genre.className = "tag";
      genre.textContent = program.genre;
      const channel = document.createElement("span");
      channel.textContent = program.channel;
      meta.append(genre, channel);
      details.append(titleRow, meta);
      item.append(time, details);
      list.append(item);
    });
    card.append(heading, list);
    scheduleElement.append(card);
  });
}

function render() {
  renderDayFilters();
  renderViewFilters();
  renderFavorites();
  renderChannelOptions();
  renderSchedule();
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("CSV 파일의 따옴표가 닫히지 않았습니다.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function currentKoreanDay() {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date());
  return { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토", Sun: "일" }[weekday];
}

function parseCellPrograms(cell) {
  const starts = [];
  const first = cell.match(/^(\d{2})(?=.)/);
  if (first && Number(first[1]) < 60) {
    starts.push({ index: 0, minute: first[1] });
  }

  const nextProgram = /(?:HD방송|UHD방송|자막방송|화면해설|한국수어방송|재방송|생방송)\s*(\d{2})/g;
  let match;
  while ((match = nextProgram.exec(cell)) !== null) {
    if (Number(match[1]) < 60) {
      starts.push({
        index: match.index + match[0].lastIndexOf(match[1]),
        minute: match[1],
      });
    }
  }

  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? cell.length;
    const title = cell
      .slice(start.index + 2, end)
      .replace(/프로그램등급\s*\d+세|재방송|생방송|HD방송|UHD방송|자막방송|화면해설|한국수어방송/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { minute: start.minute, title };
  }).filter((program) => program.title);
}

function parseSheetSchedule(text, day) {
  const rows = parseCsvRows(text);
  const firstHeader = rows[0]?.[0]?.replace(/^\uFEFF/, "");
  if (rows.length < 3 || firstHeader !== "채널" || rows[1][0] !== "시간") {
    throw new Error("Google Sheets 편성표의 표 구조를 확인할 수 없습니다.");
  }

  const channels = rows[0];
  const programsForDay = [];
  rows.slice(2).forEach((row) => {
    const hourMatch = row[0].match(/^(\d{1,2})시/);
    if (!hourMatch) return;
    const hour = Number(hourMatch[1]);
    if (hour > 23) return;

    row.slice(1).forEach((cell, index) => {
      const channel = channels[index + 1];
      if (
        !channel ||
        !cell.trim() ||
        cell.includes("방송 시간이 아닙니다") ||
        cell.includes("방송시간이 아닙니다")
      ) return;

      parseCellPrograms(cell).forEach(({ minute, title }) => {
        programsForDay.push({
          day,
          time: `${String(hour).padStart(2, "0")}:${minute}`,
          channel,
          genre: genreFor(title),
          title,
        });
      });
    });
  });
  return programsForDay;
}

async function loadGoogleSchedule() {
  if (hasImportedSchedule) return;
  statusElement.textContent = "Google Sheets에서 오늘 편성표를 불러오는 중...";

  try {
    const day = currentKoreanDay();
    const schedules = await Promise.all(SHEET_TABS.map(async ({ gid }) => {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`시트 ${gid}에서 HTTP ${response.status} 응답을 받았습니다.`);
      return parseSheetSchedule(await response.text(), day);
    }));
    programs = validatePrograms(schedules.flat());
    render();
    statusElement.textContent = programs.length
      ? `Google Sheets에서 오늘(${day}요일) 편성 ${programs.length}개를 불러왔습니다.`
      : "Google Sheets에서 오늘 편성을 찾지 못했습니다.";
  } catch (error) {
    console.error("Google Sheets 편성표를 불러오지 못했습니다.", error);
    statusElement.textContent = `Google Sheets 편성표를 불러오지 못했습니다: ${error.message}`;
  }
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("헤더와 한 개 이상의 편성 정보가 필요합니다.");

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").toLowerCase());
  const required = ["day", "time", "channel", "title"];
  const indexes = required.map((header) => headers.indexOf(header));
  if (indexes.some((index) => index < 0)) {
    throw new Error("CSV 헤더는 day,time,channel,title 형식이어야 합니다.");
  }

  return validatePrograms(rows.slice(1).map((values) => (
    {
      ...Object.fromEntries(required.map((header, index) => [header, values[indexes[index]] || ""])),
      genre: "미분류",
    }
  )));
}

csvFileInput.addEventListener("change", async () => {
  const [file] = csvFileInput.files;
  if (!file) return;
  try {
    const imported = parseCsv(await file.text());
    savePrograms(imported);
  } catch (error) {
    console.error("CSV 편성표를 가져오지 못했습니다.", error);
    statusElement.textContent = `가져오지 못했습니다: ${error.message}`;
  } finally {
    csvFileInput.value = "";
  }
});

favoritesFileInput.addEventListener("change", async () => {
  const [file] = favoritesFileInput.files;
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.version !== FAVORITES_BACKUP_VERSION) {
      throw new Error("지원하지 않는 즐겨찾기 백업 파일입니다.");
    }
    saveFavorites(backup.favorites);
  } catch (error) {
    console.error("즐겨찾기 백업을 불러오지 못했습니다.", error);
    statusElement.textContent = `백업을 불러오지 못했습니다: ${error.message}`;
  } finally {
    favoritesFileInput.value = "";
  }
});

document.querySelector("#backup-button").addEventListener("click", downloadFavoritesBackup);

document.querySelector("#favorite-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const favorite = favoriteInput.value.trim();
  if (!favorite) return;
  const normalized = normalizeTitle(favorite);
  if (favorites.some((item) => normalizeTitle(item) === normalized)) {
    statusElement.textContent = "이미 즐겨찾기에 등록된 프로그램입니다.";
    return;
  }
  favoriteInput.value = "";
  saveFavorites([...favorites, favorite]);
});

genreFilter.addEventListener("change", renderSchedule);
channelFilter.addEventListener("change", renderSchedule);
document.querySelector("#reset-button").addEventListener("click", () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    hasImportedSchedule = false;
    programs = [];
    statusElement.textContent = "Google Sheets 편성표를 다시 불러옵니다.";
    render();
    loadGoogleSchedule();
  } catch (error) {
    console.error("편성표를 초기화하지 못했습니다.", error);
    statusElement.textContent = "편성표를 초기화하지 못했습니다.";
  }
});

render();
loadClassifications().then(loadGoogleSchedule);
