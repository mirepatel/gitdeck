export interface RepoData {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count: number;
  subscribers_count: number;
  license: { name: string; spdx_id: string } | null;
  language: string | null;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  owner: {
    login: string;
    avatar_url: string;
    html_url: string;
    type: string;
  };
  default_branch: string;
  topics?: string[];
  size: number;
}

export interface CommitItem {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  author: { login: string; avatar_url: string; html_url: string } | null;
  committer: { login: string; avatar_url: string; html_url: string } | null;
}

export interface IssueItem {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  created_at: string;
  closed_at: string | null;
  pull_request?: { url: string } | null;
  user: { login: string; avatar_url: string; html_url: string };
  comments: number;
  labels: { name: string; color: string }[];
}

export interface ContributorItem {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

export type Languages = Record<string, number>;

export interface DependencyInfo {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  hasPackageJson: boolean;
}

export interface CommunityProfile {
  health_percentage: number;
  files: {
    code_of_conduct: boolean | null;
    contributing: boolean | null;
    issue_template: boolean | null;
    pull_request_template: boolean | null;
    license: boolean | null;
    readme: boolean | null;
  };
}

export interface FetchResult {
  repo: RepoData | null;
  commits: CommitItem[];
  issues: IssueItem[];
  contributors: ContributorItem[];
  languages: Languages;
  dependencies: DependencyInfo;
  community: CommunityProfile | null;
  error: string | null;
  rateLimit: { remaining: number; limit: number; reset: number } | null;
}
