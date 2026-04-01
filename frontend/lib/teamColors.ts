const SPORT_TEAM_PRIMARY_COLORS: Record<string, Record<string, string>> = {
  MLB: {
    ARI: "#A71930",
    ATH: "#003831",
    ATL: "#CE1141",
    BAL: "#DF4601",
    BOS: "#BD3039",
    CHC: "#0E3386",
    CWS: "#27251F",
    CIN: "#C6011F",
    CLE: "#E31937",
    COL: "#33006F",
    DET: "#0C2340",
    HOU: "#002D62",
    KC: "#004687",
    LAA: "#BA0021",
    LAD: "#005A9C",
    MIA: "#00A3E0",
    MIL: "#12284B",
    MIN: "#002B5C",
    NYM: "#002D72",
    NYY: "#0C2340",
    PHI: "#E81828",
    PIT: "#FDB827",
    SD: "#2F241D",
    SEA: "#0C2C56",
    SF: "#FD5A1E",
    STL: "#C41E3A",
    TB: "#092C5C",
    TEX: "#003278",
    TOR: "#134A8E",
    WSH: "#AB0003",
  },
  NFL: {
    ARI: "#97233F",
    ATL: "#A71930",
    BAL: "#241773",
    BUF: "#00338D",
    CAR: "#0085CA",
    CHI: "#0B162A",
    CIN: "#FB4F14",
    CLE: "#311D00",
    DAL: "#003594",
    DEN: "#FB4F14",
    DET: "#0076B6",
    GB: "#203731",
    HOU: "#03202F",
    IND: "#002C5F",
    JAX: "#006778",
    KC: "#E31837",
    LV: "#000000",
    LAC: "#0080C6",
    LAR: "#003594",
    MIA: "#008E97",
    MIN: "#4F2683",
    NE: "#002244",
    NO: "#101820",
    NYG: "#0B2265",
    NYJ: "#125740",
    PHI: "#004C54",
    PIT: "#FFB612",
    SEA: "#002244",
    SF: "#AA0000",
    TB: "#D50A0A",
    TEN: "#0C2340",
    WAS: "#5A1414",
  },
};

const TEAM_CODE_ALIASES: Record<string, Record<string, string>> = {
  MLB: {
    CHI: "CHC",
    CHW: "CWS",
    CWS: "CWS",
    KCR: "KC",
    SFG: "SF",
    SFN: "SF",
    TBR: "TB",
    WAS: "WSH",
    WSN: "WSH",
  },
  NFL: {
    JAC: "JAX",
  },
};

const TEAM_FALLBACK_PALETTE = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#17becf",
  "#bcbd22",
  "#7f7f7f",
];

function normalizeTeamCode(team: string, sportKey: string): string {
  const raw = team.trim().toUpperCase();
  const alnum = raw.replace(/[^A-Z0-9]/g, "");
  if (!alnum) return "";
  const aliases = TEAM_CODE_ALIASES[sportKey];
  if (aliases?.[alnum]) return aliases[alnum];
  return alnum;
}

function paletteFallbackColor(seed: string): string {
  if (!seed) return "#117c63";
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return TEAM_FALLBACK_PALETTE[hash % TEAM_FALLBACK_PALETTE.length];
}

export function teamPrimaryColor(team: string, sport = ""): string {
  const sportKey = sport.trim().toUpperCase();
  const teamKey = normalizeTeamCode(team, sportKey);
  if (!teamKey) return "#117c63";

  const sportMap = SPORT_TEAM_PRIMARY_COLORS[sportKey];
  if (sportMap?.[teamKey]) return sportMap[teamKey];

  for (const [candidateSport, candidate] of Object.entries(SPORT_TEAM_PRIMARY_COLORS)) {
    const candidateTeamKey = normalizeTeamCode(team, candidateSport);
    if (!candidateTeamKey) continue;
    if (candidate[candidateTeamKey]) return candidate[candidateTeamKey];
    if (candidate[teamKey]) return candidate[teamKey];
  }

  return paletteFallbackColor(`${sportKey}:${teamKey}`);
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return [17, 124, 99];
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [17, 124, 99];
  return [r, g, b];
}

export function teamColorRgb(team: string, sport = ""): string {
  const [r, g, b] = hexToRgb(teamPrimaryColor(team, sport));
  return `${r}, ${g}, ${b}`;
}
