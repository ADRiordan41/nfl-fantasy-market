const SPORT_TEAM_PRIMARY_COLORS: Record<string, Record<string, string>> = {
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

export function teamPrimaryColor(team: string, sport = ""): string {
  const teamKey = team.toUpperCase();
  const sportKey = sport.trim().toUpperCase();
  const sportMap = SPORT_TEAM_PRIMARY_COLORS[sportKey];
  if (sportMap?.[teamKey]) return sportMap[teamKey];

  for (const candidate of Object.values(SPORT_TEAM_PRIMARY_COLORS)) {
    if (candidate[teamKey]) return candidate[teamKey];
  }

  return "#117c63";
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
