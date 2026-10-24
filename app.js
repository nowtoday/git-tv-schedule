const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const FAVORITES_KEY = "my-tv-guide-favorites-v1";
const LOCAL_SCHEDULE_OVERRIDES_KEY = "my-tv-guide-schedule-overrides-v1";
const LOCAL_SCHEDULE_OVERRIDE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const LEGACY_SCHEDULE_KEYS = ["my-tv-guide-schedule-v1", "my-tv-guide-schedule-source-v1"];
const FAVORITES_BACKUP_VERSION = 1;
const SCHEDULE_BACKUP_VERSION = 1;
const GENRES = ["미분류", "예능", "교양/다큐", "드라마"];
const GENRE_SETTINGS_URL = new URL("genres.json", document.baseURI);
const SCHEDULE_URL = new URL("schedule.json", document.baseURI);
const SHEET_ID = "1D9jF3KVYAZBvYRDMzZ8oEnGwVojanrIW7FQFl4n2TOk";
const SHEET_TABS = ["0", "48397256", "278462282"];

const scheduleElement = document.querySelector("#schedule");
const dayFilters = document.querySelector("#day-filters");
const genreFilter = document.querySelector("#genre-filter");
const channelPicker = document.querySelector("#channel-picker");
const channelPickerSummary = document.querySelector("#channel-picker-summary");
const channelOptions = document.querySelector("#channel-options");
const statusElement = document.querySelector("#status");
const csvFileInput = document.querySelector("#csv-file");
const scheduleRefreshButton = document.querySelector("#schedule-refresh-button");
const manualSheetRefreshButton = document.querySelector("#manual-sheet-refresh-button");
const favoriteListElement = document.querySelector("#favorite-list");
const favoriteExpandButton = document.querySelector("#toggle-favorites");
const favoriteInput = document.querySelector("#favorite-input");
const viewFilters = document.querySelector("#view-filters");
const favoritesFileInput = document.querySelector("#favorites-file");
const scheduleFileInput = document.querySelector("#schedule-file");
let selectedDay = "";
let selectedChannels = null;
let favoritesExpanded = false;
let classifications = {};
let programs = [];
let publishedSchedule = null;
let activeLocalOverrideDays = [];
let favorites = loadFavorites();
let viewMode = favorites.length ? "favorites" : "all";

function clearLegacyScheduleStorage() {
  try {
    LEGACY_SCHEDULE_KEYS.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error("이전 로컬 편성 데이터를 정리하지 못했습니다.", error);
    statusElement.textContent = `이전 편성 데이터를 정리하지 못했습니다: ${error.message}`;
  }
}

function loadFavorites() {
  try {
    const cookieValue = readCookie(FAVORITES_KEY);
    if (cookieValue !== null) {
      const migrated = validateFavorites(JSON.parse(cookieValue));
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(migrated));
      clearFavoritesCookie();
      return migrated;
    }

    const legacyValue = localStorage.getItem(FAVORITES_KEY);
    return legacyValue ? validateFavorites(JSON.parse(legacyValue)) : [];
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

function clearFavoritesCookie() {
  document.cookie = `${encodeURIComponent(FAVORITES_KEY)}=; Path=/; Max-Age=0; SameSite=Lax`;
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

function readLocalScheduleOverrides() {
  const saved = localStorage.getItem(LOCAL_SCHEDULE_OVERRIDES_KEY);
  if (!saved) return {};
  const overrides = JSON.parse(saved);
  if (!overrides || overrides.version !== 1 || !overrides.days || typeof overrides.days !== "object" || Array.isArray(overrides.days)) {
    throw new Error("브라우저에 저장된 수동 편성 데이터 형식이 올바르지 않습니다.");
  }

  const now = Date.now();
  const validatedOverrides = Object.entries(overrides.days).map(([day, entry]) => {
    if (
      !DAYS.includes(day) ||
      !entry ||
      typeof entry.fetchedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.fetchedAt)) ||
      !Array.isArray(entry.programs)
    ) {
      throw new Error(`${day}요일 수동 편성의 갱신 정보가 올바르지 않습니다.`);
    }
    const dayPrograms = validatePrograms(entry.programs);
    if (dayPrograms.some((program) => program.day !== day)) {
      throw new Error(`${day}요일 수동 편성에 다른 요일의 자료가 포함되어 있습니다.`);
    }
    return [day, { fetchedAt: entry.fetchedAt, programs: dayPrograms }];
  });
  const freshOverrides = Object.fromEntries(validatedOverrides.filter(([, entry]) => (
    now - Date.parse(entry.fetchedAt) < LOCAL_SCHEDULE_OVERRIDE_MAX_AGE
  )));

  if (Object.keys(freshOverrides).length !== validatedOverrides.length) {
    if (Object.keys(freshOverrides).length) {
      localStorage.setItem(
        LOCAL_SCHEDULE_OVERRIDES_KEY,
        JSON.stringify({ version: 1, days: freshOverrides }),
      );
    } else {
      localStorage.removeItem(LOCAL_SCHEDULE_OVERRIDES_KEY);
    }
  }
  return freshOverrides;
}

function saveLocalScheduleOverride(day, dayPrograms, fetchedAt) {
  const overrides = readLocalScheduleOverrides();
  overrides[day] = { fetchedAt, programs: dayPrograms };
  localStorage.setItem(LOCAL_SCHEDULE_OVERRIDES_KEY, JSON.stringify({ version: 1, days: overrides }));
}

function applyLocalScheduleOverrides(basePrograms, schedule) {
  const overrides = readLocalScheduleOverrides();
  const updatedAtByDay = schedule.updatedAtByDay &&
    typeof schedule.updatedAtByDay === "object" &&
    !Array.isArray(schedule.updatedAtByDay)
    ? schedule.updatedAtByDay
    : {};
  const survivingOverrides = {};
  let mergedPrograms = [...basePrograms];
  activeLocalOverrideDays = [];

  Object.entries(overrides).forEach(([day, override]) => {
    const publishedAt = updatedAtByDay[day] || schedule.generatedAt;
    if (publishedAt && !Number.isFinite(Date.parse(publishedAt))) {
      throw new Error(`${day}요일 자동 편성의 갱신 시각이 올바르지 않습니다.`);
    }
    if (publishedAt && Date.parse(publishedAt) >= Date.parse(override.fetchedAt)) return;
    survivingOverrides[day] = override;
    activeLocalOverrideDays.push({ day, fetchedAt: override.fetchedAt });
    mergedPrograms = mergedPrograms.filter((program) => program.day !== day).concat(override.programs);
  });

  if (Object.keys(survivingOverrides).length !== Object.keys(overrides).length) {
    localStorage.setItem(
      LOCAL_SCHEDULE_OVERRIDES_KEY,
      JSON.stringify({ version: 1, days: survivingOverrides }),
    );
  }
  return mergedPrograms;
}

function scheduleStatus(programCount, generatedAt) {
  const source = activeLocalOverrideDays.length
    ? `브라우저 수동 갱신 우선: ${activeLocalOverrideDays.map(({ day, fetchedAt }) => (
      `${day}(${formatKoreanDateTime(fetchedAt)})`
    )).join(", ")}`
    : `자동 갱신: ${generatedAt ? formatKoreanDateTime(generatedAt) : "시각 정보 없음"}`;
  return `${programCount}개 편성을 불러왔습니다. ${source}`;
}

function formatKoreanDateTime(timestamp) {
  return `${new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(timestamp))} KST`;
}

function normalizeTitle(title) {
  return title.toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

function favoriteBaseTitle(title) {
  return title
    .replace(/\s*(?:[-–—:]\s*)?(?:제\s*)?\d+\s*(?:회|화|부|편)\s*$/i, "")
    .trim();
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
  const normalizedTitle = normalizeTitle(favoriteBaseTitle(title));
  return favorites.find((favorite) => normalizedTitle.includes(normalizeTitle(favoriteBaseTitle(favorite))));
}

function savePrograms(nextPrograms, successMessage) {
  programs = nextPrograms;
  statusElement.textContent = successMessage || `${programs.length}개 프로그램을 불러왔습니다. 이 브라우저에는 저장되지 않습니다.`;
  render();
}

function saveFavorites(nextFavorites) {
  try {
    const validated = validateFavorites(nextFavorites);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(validated));
    favorites = validated;
    if (!favorites.length) viewMode = "all";
    statusElement.textContent = `${favorites.length}개 프로그램을 이 브라우저에 저장했습니다.`;
    render();
  } catch (error) {
    console.error("즐겨찾기를 저장하지 못했습니다.", error);
    statusElement.textContent = `즐겨찾기를 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요: ${error.message}`;
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

function downloadScheduleBackup() {
  const backup = {
    version: SCHEDULE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    programs: programs.map(({ day, time, channel, title }) => ({ day, time, channel, title })),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tv-schedule-backup.json";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  statusElement.textContent = `${programs.length}개 편성을 백업 파일로 저장했습니다.`;
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
  [...new Set(programs.map((program) => program.title))]
    .sort((a, b) => a.localeCompare(b, "ko", { numeric: true, sensitivity: "base" }))
    .forEach((title) => {
      suggestions.append(new Option(title, title));
    });
  updateFavoritesCollapse();
}

function updateFavoritesCollapse() {
  favoriteListElement.classList.add("is-collapsed");
  const canCollapse = favoriteListElement.scrollHeight > favoriteListElement.clientHeight + 1;
  if (!canCollapse) favoritesExpanded = false;
  favoriteListElement.classList.toggle("is-collapsed", canCollapse && !favoritesExpanded);
  favoriteExpandButton.hidden = !canCollapse;
  favoriteExpandButton.textContent = favoritesExpanded ? "접기" : "더 보기";
  favoriteExpandButton.setAttribute("aria-expanded", String(favoritesExpanded));
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
  const channels = [...new Set(programs.map((program) => program.channel))].sort((a, b) => a.localeCompare(b, "ko"));
  if (selectedChannels !== null) {
    selectedChannels = selectedChannels.filter((channel) => channels.includes(channel));
  }

  const selectedCount = selectedChannels === null ? channels.length : selectedChannels.length;
  channelPickerSummary.textContent = selectedCount === channels.length
    ? "전체 채널"
    : selectedCount
      ? `${selectedCount}개 채널 선택`
      : "선택 채널 없음";
  channelOptions.replaceChildren();
  channels.forEach((channel) => {
    const label = document.createElement("label");
    label.className = "channel-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedChannels === null || selectedChannels.includes(channel);
    checkbox.addEventListener("change", () => {
      if (selectedChannels === null) selectedChannels = [...channels];
      if (checkbox.checked) {
        if (!selectedChannels.includes(channel)) selectedChannels.push(channel);
      } else {
        selectedChannels = selectedChannels.filter((selected) => selected !== channel);
      }
      renderChannelOptions();
      renderSchedule();
    });
    const name = document.createElement("span");
    name.textContent = channel;
    label.append(checkbox, name);
    channelOptions.append(label);
  });
}

function renderSchedule() {
  scheduleElement.classList.toggle("day-selected", Boolean(selectedDay));
  const airingPrograms = currentBroadcasts();
  const filtered = programs.filter((program) => (
    (!selectedDay || program.day === selectedDay) &&
    (!genreFilter.value || program.genre === genreFilter.value) &&
    (selectedChannels === null || selectedChannels.includes(program.channel)) &&
    (viewMode !== "favorites" || Boolean(matchingFavorite(program.title)))
  ));
  const days = selectedDay ? [selectedDay] : DAYS;

  scheduleElement.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = selectedChannels !== null && selectedChannels.length === 0
      ? "선택된 채널이 없습니다. '전체 선택'을 누르거나 채널을 체크해 주세요."
      : viewMode === "favorites"
        ? "즐겨찾기한 프로그램의 편성이 없습니다. 전체 보기에서 프로그램을 찾아 별표를 눌러 추가하세요."
        : programs.length
          ? "현재 필터에 해당하는 편성이 없습니다."
          : "표시할 편성이 없습니다. GitHub Actions에서 주간 편성을 가져와 주세요.";
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
      if (airingPrograms.has(program)) item.classList.add("program-current");
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
          saveFavorites([...favorites, favoriteBaseTitle(program.title)]);
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

function currentKoreanMinutes() {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Seoul",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function currentBroadcasts() {
  const today = currentKoreanDay();
  const now = currentKoreanMinutes();
  const byChannel = new Map();
  programs.filter((program) => program.day === today).forEach((program) => {
    if (!byChannel.has(program.channel)) byChannel.set(program.channel, []);
    byChannel.get(program.channel).push(program);
  });

  const airing = new Set();
  byChannel.forEach((channelPrograms) => {
    channelPrograms.sort((a, b) => a.time.localeCompare(b.time));
    for (let index = channelPrograms.length - 2; index >= 0; index -= 1) {
      const start = Number(channelPrograms[index].time.slice(0, 2)) * 60 +
        Number(channelPrograms[index].time.slice(3, 5));
      const nextStart = Number(channelPrograms[index + 1].time.slice(0, 2)) * 60 +
        Number(channelPrograms[index + 1].time.slice(3, 5));
      if (start <= now && now < nextStart) {
        airing.add(channelPrograms[index]);
        break;
      }
    }
  });
  return airing;
}

async function loadPublishedSchedule() {
  statusElement.textContent = "저장소의 주간 편성표를 불러오는 중...";
  scheduleRefreshButton.disabled = true;
  try {
    const response = await fetch(`${SCHEDULE_URL.href}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`저장소의 편성 파일에서 HTTP ${response.status} 응답을 받았습니다.`);
    }
    const schedule = await response.json();
    if (
      !schedule ||
      schedule.version !== 1 ||
      !Array.isArray(schedule.programs) ||
      (schedule.generatedAt !== null && schedule.generatedAt !== undefined &&
        (typeof schedule.generatedAt !== "string" || !Number.isFinite(Date.parse(schedule.generatedAt)))) ||
      (schedule.updatedAtByDay !== undefined &&
        (!schedule.updatedAtByDay || typeof schedule.updatedAtByDay !== "object" || Array.isArray(schedule.updatedAtByDay)))
    ) {
      throw new Error("schedule.json 형식이 올바르지 않습니다.");
    }
    if (
      schedule.updatedAtByDay &&
      Object.values(schedule.updatedAtByDay).some((timestamp) => (
        typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))
      ))
    ) {
      throw new Error("schedule.json에 올바르지 않은 요일별 갱신 시각이 있습니다.");
    }
    const publishedPrograms = validatePrograms(schedule.programs);
    publishedSchedule = schedule;
    const effectivePrograms = validatePrograms(applyLocalScheduleOverrides(publishedPrograms, schedule));
    if (!effectivePrograms.length) {
      programs = effectivePrograms;
      render();
      statusElement.textContent = "주간 편성표가 아직 비어 있습니다. GitHub Actions에서 'Update weekly schedule'을 실행해 주세요.";
      return;
    }
    savePrograms(
      effectivePrograms,
      scheduleStatus(effectivePrograms.length, schedule.generatedAt),
    );
  } catch (error) {
    console.error("저장소 편성표를 불러오지 못했습니다.", error);
    try {
      const overrides = readLocalScheduleOverrides();
      const localPrograms = Object.values(overrides).flatMap((override) => override.programs);
      if (localPrograms.length) {
        programs = validatePrograms(localPrograms);
        activeLocalOverrideDays = Object.entries(overrides).map(([day, override]) => ({
          day,
          fetchedAt: override.fetchedAt,
        }));
        render();
        statusElement.textContent = `저장소 편성표를 불러오지 못했습니다. 이 브라우저의 수동 편성 ${programs.length}개를 대신 표시합니다: ${error.message}`;
      } else {
        activeLocalOverrideDays = [];
        statusElement.textContent = `저장소 편성표를 불러오지 못했습니다: ${error.message}`;
      }
    } catch (localError) {
      console.error("브라우저에 저장된 수동 편성도 불러오지 못했습니다.", localError);
      statusElement.textContent = `저장소와 브라우저의 수동 편성표를 모두 불러오지 못했습니다: ${localError.message}`;
    }
  } finally {
    scheduleRefreshButton.disabled = false;
  }
}

async function loadManualSheetSchedule() {
  const day = currentKoreanDay();
  statusElement.textContent = `Google Sheets에서 ${day}요일의 최신 편성을 가져오는 중...`;
  manualSheetRefreshButton.disabled = true;
  scheduleRefreshButton.disabled = true;
  try {
    const schedules = await Promise.all(SHEET_TABS.map(async (gid) => {
      const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`시트 ${gid}에서 HTTP ${response.status} 응답을 받았습니다.`);
      return parseSheetSchedule(await response.text(), day);
    }));
    const importedPrograms = validatePrograms(schedules.flat());
    if (!importedPrograms.length) {
      throw new Error(`${day}요일 편성을 찾지 못해 현재 표시를 유지했습니다.`);
    }

    const fetchedAt = new Date().toISOString();
    saveLocalScheduleOverride(day, importedPrograms, fetchedAt);
    if (publishedSchedule) {
      programs = validatePrograms(applyLocalScheduleOverrides(
        validatePrograms(publishedSchedule.programs),
        publishedSchedule,
      ));
    } else {
      programs = importedPrograms;
    }
    render();
    statusElement.textContent = `Google Sheets에서 ${day}요일 편성 ${importedPrograms.length}개를 ${formatKoreanDateTime(fetchedAt)}에 가져왔습니다. 자동 갱신보다 최신이면 이 브라우저 자료를 우선 표시합니다.`;
  } catch (error) {
    console.error("Google Sheets 수동 갱신에 실패했습니다.", error);
    statusElement.textContent = `Google Sheets 수동 갱신에 실패했습니다: ${error.message}`;
  } finally {
    manualSheetRefreshButton.disabled = false;
    scheduleRefreshButton.disabled = false;
  }
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
    savePrograms(imported, `${imported.length}개 CSV 편성을 불러왔습니다. 이 자료는 브라우저를 닫으면 사라집니다.`);
  } catch (error) {
    console.error("CSV 편성표를 가져오지 못했습니다.", error);
    statusElement.textContent = `가져오지 못했습니다: ${error.message}`;
  } finally {
    csvFileInput.value = "";
  }
});

scheduleFileInput.addEventListener("change", async () => {
  const [file] = scheduleFileInput.files;
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (!backup || backup.version !== SCHEDULE_BACKUP_VERSION) {
      throw new Error("지원하지 않는 편성표 백업 파일입니다.");
    }
    const restoredPrograms = validatePrograms(backup.programs);
    savePrograms(restoredPrograms, `${restoredPrograms.length}개 편성을 백업에서 복원했습니다. 이 자료는 브라우저를 닫으면 사라집니다.`);
  } catch (error) {
    console.error("편성표 백업을 불러오지 못했습니다.", error);
    statusElement.textContent = `편성표 백업을 불러오지 못했습니다: ${error.message}`;
  } finally {
    scheduleFileInput.value = "";
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
document.querySelector("#schedule-backup-button").addEventListener("click", downloadScheduleBackup);
scheduleRefreshButton.addEventListener("click", loadPublishedSchedule);
manualSheetRefreshButton.addEventListener("click", loadManualSheetSchedule);
favoriteExpandButton.addEventListener("click", () => {
  favoritesExpanded = !favoritesExpanded;
  updateFavoritesCollapse();
});

document.querySelector("#favorite-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const favorite = favoriteBaseTitle(favoriteInput.value.trim());
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
window.addEventListener("resize", updateFavoritesCollapse);
window.setInterval(renderSchedule, 60 * 1000);
document.querySelector("#select-all-channels").addEventListener("click", () => {
  selectedChannels = null;
  renderChannelOptions();
  renderSchedule();
});
document.querySelector("#clear-channel-selection").addEventListener("click", () => {
  selectedChannels = [];
  renderChannelOptions();
  renderSchedule();
});
render();
clearLegacyScheduleStorage();
loadClassifications().then(loadPublishedSchedule);
