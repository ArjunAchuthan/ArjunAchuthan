/**
 * Ball-drop contribution graph generator
 * -----------------------------------------
 * 1. Fetches your real GitHub contribution calendar via the GraphQL API
 * 2. Turns each week into a "bounce": the ball bounces HIGHER on weeks
 *    where you committed more (bounce height ~ energy ~ contribution count)
 * 3. Writes an animated SVG that loops forever
 *
 * Beginner note: you don't need to understand every line below to use this.
 * You only need to set two environment variables (see README-SETUP.md):
 *   GH_TOKEN     -> a GitHub Personal Access Token (read-only, "read:user" scope)
 *   GH_USERNAME  -> your GitHub username
 */

const GH_TOKEN = process.env.GH_TOKEN;
const GH_USERNAME = process.env.GH_USERNAME;

if (!GH_TOKEN || !GH_USERNAME) {
  console.error("Missing GH_TOKEN or GH_USERNAME environment variables.");
  process.exit(1);
}

// ---------- 1. Fetch contribution data ----------

const QUERY = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
            weekday
          }
        }
      }
    }
  }
}`;

async function fetchContributions() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${GH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: GH_USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

// ---------- 2. Layout + physics constants ----------

const CELL = 11; // px, same as GitHub's real grid
const GAP = 3;
const STEP = CELL + GAP;
const ROWS = 7; // Sun..Sat
const PADDING = 20;

const SECONDS_PER_WEEK = 0.45; // how long the ball spends bouncing across one column
const MAX_BOUNCE = STEP * ROWS * 0.9; // tallest possible bounce (px)
const MIN_BOUNCE = STEP * 0.6; // even a "zero" week gets a small bounce so it stays lively

// GitHub-style green shades (level 0 = no contributions .. level 4 = very active)
const COLORS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

function levelFor(count, max) {
  if (count === 0) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

// ---------- 3. Build the SVG ----------

function buildSVG(weeks) {
  const numWeeks = weeks.length;
  const width = PADDING * 2 + numWeeks * STEP;
  const height = PADDING * 2 + ROWS * STEP + 20; // extra headroom for the bounce

  // find the single highest day count, used to scale colors AND bounce height
  let maxDayCount = 0;
  const weekTotals = weeks.map((w) => {
    let total = 0;
    w.contributionDays.forEach((d) => {
      total += d.contributionCount;
      if (d.contributionCount > maxDayCount) maxDayCount = d.contributionCount;
    });
    return total;
  });
  const maxWeekTotal = Math.max(...weekTotals, 1);

  const baselineY = PADDING + ROWS * STEP; // ball rests on the bottom edge of the grid
  const totalDuration = numWeeks * SECONDS_PER_WEEK;

  // ---- grid cells ----
  let cellsSVG = "";
  weeks.forEach((week, wi) => {
    week.contributionDays.forEach((day) => {
      const level = levelFor(day.contributionCount, maxDayCount);
      const x = PADDING + wi * STEP;
      const y = PADDING + day.weekday * STEP;

      // Each cell "flashes" brighter for an instant when the ball bounces
      // through its column. We express this as one <animate> covering the
      // WHOLE loop timeline (keyTimes), so it stays perfectly in sync forever.
      const flashStart = (wi * SECONDS_PER_WEEK) / totalDuration;
      const flashPeak = (wi * SECONDS_PER_WEEK + 0.15) / totalDuration;
      const flashEnd = (wi * SECONDS_PER_WEEK + 0.3) / totalDuration;

      cellsSVG += `
        <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2"
              fill="${COLORS[level]}" stroke="#ffffff22" stroke-width="0.5">
          <animate attributeName="opacity"
            keyTimes="0;${flashStart.toFixed(4)};${flashPeak.toFixed(4)};${flashEnd.toFixed(4)};1"
            values="1;1;0.35;1;1"
            dur="${totalDuration}s"
            repeatCount="indefinite" />
        </rect>`;
    });
  });

  // ---- bounce path (one quadratic arc per week) ----
  let pathD = `M ${PADDING} ${baselineY}`;
  weeks.forEach((week, wi) => {
    const x0 = PADDING + wi * STEP;
    const xMid = x0 + STEP / 2;
    const x1 = x0 + STEP;

    const bounceHeight =
      MIN_BOUNCE + (MAX_BOUNCE - MIN_BOUNCE) * (weekTotals[wi] / maxWeekTotal);
    const peakY = baselineY - bounceHeight;

    // Two quadratic curves: up to the peak, then down again (a proper "arc")
    pathD += ` Q ${x0 + STEP * 0.15} ${peakY} ${xMid} ${peakY}`;
    pathD += ` Q ${x1 - STEP * 0.15} ${peakY} ${x1} ${baselineY}`;
  });

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="transparent"/>

  <!-- contribution grid -->
  ${cellsSVG}

  <!-- invisible path the ball follows -->
  <path id="ballPath" d="${pathD}" fill="none" stroke="none"/>

  <!-- the ball itself -->
  <circle r="4" fill="#ff7b72">
    <animateMotion dur="${totalDuration}s" repeatCount="indefinite" rotate="auto">
      <mpath href="#ballPath"/>
    </animateMotion>
  </circle>
</svg>`.trim();

  return svg;
}

// ---------- 4. Run ----------

(async () => {
  try {
    const weeks = await fetchContributions();
    const svg = buildSVG(weeks);
    const fs = await import("node:fs");
    fs.mkdirSync("dist", { recursive: true });
    fs.writeFileSync("dist/ball-drop.svg", svg);
    console.log(`Generated dist/ball-drop.svg from ${weeks.length} weeks of data.`);
  } catch (err) {
    console.error("Failed to generate ball-drop.svg:", err.message);
    process.exit(1);
  }
})();
