import type { CommitItem, ContributorItem, IssueItem, RepoData } from './types';

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toLocaleString();
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days >= 365) return `${Math.floor(days / 365)}y ago`;
  if (days >= 30) return `${Math.floor(days / 30)}mo ago`;
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(diff / 60_000);
  return mins >= 1 ? `${mins}m ago` : 'just now';
}

export function ageDays(iso: string, endIso?: string | null): number {
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(iso).getTime()) / 86_400_000));
}

// Group commits by day for the timeline chart
export function commitTimeline(commits: CommitItem[]): { date: string; count: number }[] {
  const map = new Map<string, number>();
  commits.forEach((c) => {
    const d = new Date(c.commit.author.date);
    const key = d.toISOString().slice(0, 10);
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  const sorted = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  // If too many points, bucket by week
  if (sorted.length > 30) {
    const weekly = new Map<string, number>();
    sorted.forEach(([date, count]) => {
      const d = new Date(date);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - day);
      const key = monday.toISOString().slice(0, 10);
      weekly.set(key, (weekly.get(key) ?? 0) + count);
    });
    return [...weekly.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({
        date: new Date(date).toLocaleDateString('en', {
          month: 'short',
          day: 'numeric',
        }),
        count,
      }));
  }
  return sorted.map(([date, count]) => ({
    date: new Date(date).toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
    }),
    count,
  }));
}

export function authorDistribution(
  commits: CommitItem[]
): { login: string; avatar: string; count: number }[] {
  const map = new Map<string, { avatar: string; count: number }>();
  commits.forEach((c) => {
    const login = c.author?.login ?? c.commit.author.name;
    const avatar = c.author?.avatar_url ?? '';
    const existing = map.get(login);
    if (existing) existing.count += 1;
    else map.set(login, { avatar, count: 1 });
  });
  return [...map.entries()]
    .map(([login, v]) => ({ login, avatar: v.avatar, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

export function recentCommits(
  commits: CommitItem[],
  limit = 5
): CommitItem[] {
  return [...commits]
    .sort(
      (a, b) =>
        new Date(b.commit.author.date).getTime() -
        new Date(a.commit.author.date).getTime()
    )
    .slice(0, limit);
}

export function issueStats(issues: IssueItem[]) {
  const realIssues = issues.filter((i) => !i.pull_request);
  const prs = issues.filter((i) => !!i.pull_request);
  const openIssues = realIssues.filter((i) => i.state === 'open');
  const closedIssues = realIssues.filter((i) => i.state === 'closed');
  const openPrs = prs.filter((i) => i.state === 'open');
  const closedPrs = prs.filter((i) => i.state === 'closed');
  const avgAgeOpen = openIssues.length
    ? Math.round(
        openIssues.reduce((sum, i) => sum + ageDays(i.created_at), 0) /
          openIssues.length
      )
    : 0;
  return {
    realIssues,
    prs,
    openIssues,
    closedIssues,
    openPrs,
    closedPrs,
    avgAgeOpen,
    openRatio: realIssues.length
      ? (openIssues.length / realIssues.length) * 100
      : 0,
  };
}

export interface BusFactor {
  score: number; // 0-100, higher = riskier
  label: 'Low' | 'Moderate' | 'High' | 'Critical';
  topShare: number; // top contributor's share 0-1
  topContributor: string;
  totalContributors: number;
}

export function busFactor(contributors: ContributorItem[]): BusFactor {
  const total = contributors.reduce((s, c) => s + c.contributions, 0);
  if (!total || contributors.length === 0) {
    return {
      score: 100,
      label: 'Critical',
      topShare: 0,
      topContributor: '—',
      totalContributors: 0,
    };
  }
  const top = contributors[0];
  const topShare = top.contributions / total;
  // Score: high topShare + few contributors = high risk
  const concentration = Math.round(topShare * 70);
  const scarcity = Math.round(
    Math.min(30, Math.max(0, (5 - contributors.length) * 6))
  );
  const score = Math.min(100, Math.max(0, concentration + scarcity));
  const label: BusFactor['label'] =
    score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Moderate' : 'Low';
  return {
    score,
    label,
    topShare,
    topContributor: top.login,
    totalContributors: contributors.length,
  };
}

export interface HealthScore {
  score: number; // 0-100, higher = healthier
  label: 'Low' | 'Moderate' | 'High' | 'Very High';
  activity: string;
}

// Overall repo health: commit frequency + issue resolution ratio
export function healthScore(
  commits: CommitItem[],
  issues: IssueItem[]
): HealthScore {
  const stats = issueStats(issues);

  // Commit frequency: commits per day across the sampled window
  const days = commits.length > 0
    ? Math.max(
        1,
        (Date.now() - new Date(commits[commits.length - 1].commit.author.date).getTime()) / 86_400_000
      )
    : 1;
  const commitsPerDay = commits.length / days;
  // 1+ commits/day saturates the activity component
  const activityScore = Math.min(50, Math.round(commitsPerDay * 35));

  // Issue resolution: closed / total (higher closed ratio = healthier)
  const totalIssues = stats.realIssues.length;
  const resolutionScore = totalIssues > 0
    ? Math.round((stats.closedIssues.length / totalIssues) * 50)
    : 25; // neutral when no issue history

  const score = Math.min(100, Math.max(0, activityScore + resolutionScore));
  const label: HealthScore['label'] =
    score >= 80 ? 'Very High'
      : score >= 60 ? 'High'
      : score >= 40 ? 'Moderate'
      : 'Low';
  const activity =
    commitsPerDay >= 1 ? 'High Activity'
      : commitsPerDay >= 0.3 ? 'Active'
      : commitsPerDay > 0 ? 'Low Activity'
      : 'Inactive';
  return { score, label, activity };
}

// GitHub language color palette (well-known)
export const LANGUAGE_COLORS: Record<string, string> = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572A5',
  Java: '#b07219',
  Go: '#00ADD8',
  Rust: '#dea584',
  C: '#555555',
  'C++': '#f34b7d',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Shell: '#89e051',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Lua: '#000080',
  Perl: '#0298c3',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Clojure: '#db5855',
  Scala: '#c22d40',
  R: '#198CE7',
  Julia: '#a270ba',
  Zig: '#ec915c',
  'Jupyter Notebook': '#DA5B0B',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  Markdown: '#083fa1',
  Astro: '#ff5a03',
  Solidity: '#AA6741',
  PowerShell: '#012456',
  'Vim Script': '#199f4b',
  'Emacs Lisp': '#c065db',
};

export function languageColor(name: string): string {
  return LANGUAGE_COLORS[name] ?? '#8b949e';
}

function totalIssuesText(total: number, closed: number): string {
  if (total === 0) return 'No issue history';
  return `${closed}/${total} closed (${((closed / total) * 100).toFixed(1)}%)`;
}

export function buildAuditMarkdown(
  repo: RepoData,
  commits: CommitItem[],
  issues: IssueItem[],
  contributors: ContributorItem[],
  languages: Record<string, number>
): string {
  const stats = issueStats(issues);
  const bf = busFactor(contributors);
  const hs = healthScore(commits, issues);
  const langTotal = Object.values(languages).reduce((s, v) => s + v, 0);
  const langLines = Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => {
      const pct = ((bytes / langTotal) * 100).toFixed(1);
      return `- **${name}**: ${pct}%`;
    })
    .join('\n');

  const topContribs = contributors
    .slice(0, 10)
    .map((c, i) => `${i + 1}. [@${c.login}](${c.html_url}) — ${c.contributions} contributions`)
    .join('\n');

  const recent = recentCommits(commits, 10)
    .map((c) => {
      const author = c.author?.login ?? c.commit.author.name;
      const msg = c.commit.message.split('\n')[0].slice(0, 80);
      return `- ${msg} — @${author}`;
    })
    .join('\n');

  return `# GitDeck Health Audit Report

**Repository:** [${repo.full_name}](${repo.html_url})
**Description:** ${repo.description ?? '—'}
**Generated:** ${new Date().toLocaleString()}

## Vitals
| Metric | Value |
|---|---|
| Stars | ${formatNumber(repo.stargazers_count)} |
| Forks | ${formatNumber(repo.forks_count)} |
| Open Issues | ${repo.open_issues_count} |
| Watchers | ${formatNumber(repo.watchers_count)} |
| Subscribers | ${formatNumber(repo.subscribers_count)} |
| License | ${repo.license?.name ?? 'None'} |
| Main Language | ${repo.language ?? '—'} |
| Default Branch | ${repo.default_branch} |
| Created | ${new Date(repo.created_at).toLocaleDateString()} |
| Last Push | ${timeAgo(repo.pushed_at)} |

## Overall Health Score
**${hs.score}/100 — ${hs.label} (${hs.activity})**
- Commit Frequency: ${commits.length} commits over ${Math.max(1, Math.round((Date.now() - new Date(commits[commits.length - 1]?.commit.author.date ?? repo.created_at).getTime()) / 86_400_000))} days
- Issue Resolution: ${totalIssuesText(stats.realIssues.length, stats.closedIssues.length)}

## Commit Activity
- Commits analyzed (recent sample): ${commits.length}
- Unique authors: ${new Set(commits.map((c) => c.author?.login ?? c.commit.author.name)).size}

### Recent Commits
${recent || '—'}

## Issue & PR Health
- Open Issues: ${stats.openIssues.length}
- Closed Issues: ${stats.closedIssues.length}
- Open Ratio: ${stats.openRatio.toFixed(1)}%
- Average Age of Open Issues: ${stats.avgAgeOpen} days
- Open PRs: ${stats.openPrs.length}
- Closed/Merged PRs: ${stats.closedPrs.length}

## Contributor Network
- Total Contributors: ${contributors.length}
- Top Contributor: @${bf.topContributor} (${(bf.topShare * 100).toFixed(1)}% of commits)
- **Bus Factor Risk:** ${bf.label} (${bf.score}/100)

### Top Contributors
${topContribs || '—'}

## Language Distribution
${langLines || '—'}

---
_Report generated by GitDeck._
`;
}
