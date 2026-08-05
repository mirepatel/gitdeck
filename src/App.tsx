import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  Star, GitFork, AlertCircle, Scale, Code2, Eye, Search, Activity,
  Users, FileCode2, GitCommitHorizontal, Download, X, Github,
  TrendingUp, AlertTriangle, ShieldAlert, CheckCircle2, Clock,
  ChevronRight, Sparkles, Gauge, Bookmark, LogOut, User as UserIcon,
  Archive, Loader2, Mail, Lock, ChevronDown, Settings, KeyRound, Trash2,
  ArrowRight, Zap, FileJson, FileType, ChevronDown as ChevronDownIcon, Package,
  Heart, Check, BookOpen, FileText, GitPullRequest, ExternalLink,
  XCircle, Tag, GitBranch,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { fetchRepoData, parseRepoInput, getStoredToken, setStoredToken } from './github';
import type { FetchResult, RepoData, CommunityProfile } from './types';
import type { User } from '@supabase/supabase-js';
import {
  formatNumber, timeAgo, commitTimeline, authorDistribution,
  recentCommits, issueStats, busFactor, languageColor, buildAuditMarkdown,
  healthScore,
} from './analytics';
import { useAuth } from './lib/auth';
import { supabase } from './lib/supabase';
import {
  listArchivedReports, archiveAuditReport, downloadArchivedReport,
  type ArchivedReport,
} from './lib/storage';

const PRESETS = [
  'facebook/react',
  'vercel/next.js',
  'tailwindlabs/tailwindcss',
];

const TABS = [
  { id: 'velocity', label: 'Commit Velocity', icon: Activity },
  { id: 'issues', label: 'Issue & PR Health', icon: AlertCircle },
  { id: 'contributors', label: 'Contributor Network', icon: Users },
  { id: 'languages', label: 'Codebase', icon: FileCode2 },
] as const;

type TabId = typeof TABS[number]['id'];

const TOOLTIP_STYLE = {
  background: 'rgba(9,9,11,0.96)',
  border: '1px solid #27272a',
  borderRadius: 12,
  fontSize: 12,
  color: '#e4e4e7',
} as const;

/* Shared logo SVG — identical paths to favicon.svg */
function LogoIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M12 10L7 16L12 22" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 10L25 16L20 22" stroke="#a1a1aa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="18" y1="8" x2="14" y2="24" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function App() {
  const { user, loading: authLoading, signOut } = useAuth();
  const [input, setInput] = useState('');
  const [activeRepo, setActiveRepo] = useState<string | null>(null);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchRepoData>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('velocity');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportData, setReportData] = useState<FetchResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<'bookmarks' | 'audits'>('bookmarks');
  const [toast, setToast] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const showHero = !activeRepo;

  useEffect(() => {
    setHasToken(!!getStoredToken());
  }, [settingsOpen]);

  /* Global ⌘K / Ctrl+K shortcut — focuses the header search from any page */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = document.getElementById('global-search-input') as HTMLInputElement | null;
        el?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const refreshBookmarks = useCallback(async () => {
    if (!user) {
      setBookmarks([]);
      return;
    }
    const { data: rows, error } = await supabase
      .from('bookmarks')
      .select('repo_full_name')
      .order('created_at', { ascending: false });
    if (!error && rows) {
      setBookmarks(rows.map((r) => r.repo_full_name));
    }
  }, [user]);

  useEffect(() => {
    refreshBookmarks();
  }, [refreshBookmarks]);

  useEffect(() => {
    setIsBookmarked(bookmarks.includes(activeRepo ?? ''));
  }, [bookmarks, activeRepo]);

  const load = useCallback(async (repoKey: string) => {
    const parsed = parseRepoInput(repoKey);
    if (!parsed) {
      setData({
        repo: null, commits: [], issues: [], contributors: [], languages: {},
        dependencies: { dependencies: {}, devDependencies: {}, hasPackageJson: false },
        community: null,
        release: null,
        error: 'Enter a valid repo like "owner/name" or a GitHub URL.', rateLimit: null,
      });
      return;
    }
    setLoading(true);
    setData(null);
    const result = await fetchRepoData(parsed.owner, parsed.repo);
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (activeRepo) load(activeRepo);
  }, [activeRepo, load]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseRepoInput(input);
    if (parsed) setActiveRepo(`${parsed.owner}/${parsed.repo}`);
  };

  const onExport = () => {
    if (!data?.repo) return;
    if (!user) {
      showToast('Please Sign In to save bookmarks and audits.');
      setAuthModalOpen(true);
      return;
    }
    setReportData(data);
    setReportText(
      buildAuditMarkdown(
        data.repo, data.commits, data.issues, data.contributors, data.languages
      )
    );
    setReportOpen(true);
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      showToast('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Copy failed — select and copy manually.');
    }
  };

  const downloadReport = (format: 'md' | 'json' | 'pdf') => {
    if (!reportData?.repo) return;
    const baseName = (activeRepo ?? 'repo').replace('/', '-');
    if (format === 'md') {
      const blob = new Blob([reportText], { type: 'text/markdown' });
      triggerDownload(blob, `${baseName}-audit.md`);
    } else if (format === 'json') {
      const jsonData = buildAuditJson(reportData);
      const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
      triggerDownload(blob, `${baseName}-audit.json`);
    } else if (format === 'pdf') {
      downloadPdf(reportData, reportText, baseName);
    }
    showToast(`${format.toUpperCase()} downloaded!`);
  };

  const saveToStorage = async () => {
    if (!data?.repo || !user) {
      showToast('Sign in to save audit reports to your archive.');
      return;
    }
    const markdown = buildAuditMarkdown(
      data.repo, data.commits, data.issues, data.contributors, data.languages
    );
    const result = await archiveAuditReport(data, markdown);
    if (result.success) {
      showToast('Audit saved to storage!');
    } else {
      showToast(result.error ?? 'Failed to save report.');
    }
  };

  const toggleBookmark = async () => {
    if (!user) {
      showToast('Please Sign In to save bookmarks and audits.');
      setAuthModalOpen(true);
      return;
    }
    if (!activeRepo) return;
    setBookmarking(true);
    if (isBookmarked) {
      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('repo_full_name', activeRepo);
      if (!error) {
        showToast('Bookmark removed');
        refreshBookmarks();
      }
    } else {
      const { error } = await supabase
        .from('bookmarks')
        .insert({ repo_full_name: activeRepo });
      if (!error) {
        showToast('Repository bookmarked!');
        refreshBookmarks();
      } else {
        showToast(error.message);
      }
    }
    setBookmarking(false);
  };

  return (
    <div className="min-h-screen bg-transparent text-zinc-200">
      {/* Ambient radial glow + grid background (fixed, non-blocking) */}
      <div className="fixed inset-0 -z-10 bg-zinc-950" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_50%_50%_at_50%_0%,rgba(99,102,241,0.18),transparent_70%)]" />
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:24px_24px]" />

      <Header
        input={input}
        setInput={setInput}
        onSubmit={onSubmit}
        showSearch={!showHero}
        rateLimit={data?.rateLimit ?? null}
        user={user}
        authLoading={authLoading}
        onOpenAuth={() => setAuthModalOpen(true)}
        onOpenProfile={() => { setProfileInitialTab('bookmarks'); setProfileOpen(true); }}
        onOpenProfileAudits={() => { setProfileInitialTab('audits'); setProfileOpen(true); }}
        onSignOut={async () => {
          try { await signOut(); } catch { /* session clears locally regardless */ }
          showToast('Signed out');
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        hasToken={hasToken}
        searchInputRef={searchInputRef}
        onLogoClick={() => { setActiveRepo(null); setInput(''); }}
      />

      <main className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8 bg-transparent">
        <AnimatePresence mode="wait">
          {showHero && (
            <HeroSection
              key="hero"
              input={input}
              setInput={setInput}
              onSubmit={onSubmit}
              onSelectPreset={(r) => setActiveRepo(r)}
              searchInputRef={searchInputRef}
            />
          )}

          {!showHero && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <PresetBar
                activeRepo={activeRepo ?? ''}
                onSelect={setActiveRepo}
                bookmarks={bookmarks}
                user={user}
              />

              <AnimatePresence mode="wait">
                {loading && <LoadingState key="loading" />}
                {!loading && data?.error && (
                  <ErrorState
                    key="error"
                    message={data.error}
                    isRateLimit={data.rateLimit?.remaining === 0}
                    onAddToken={() => setSettingsOpen(true)}
                  />
                )}
                {!loading && data?.repo && (
                  <motion.div
                    key="content"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="mt-6 space-y-6">
                      <VitalsBanner
                        repo={data.repo}
                        data={data}
                        isBookmarked={isBookmarked}
                        onBookmark={toggleBookmark}
                        bookmarking={bookmarking}
                        onExport={onExport}
                        canExport={!!data.repo && !loading}
                      />
                      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl overflow-hidden">
                        <div className="flex flex-row gap-4 border-b border-zinc-800 w-full overflow-x-auto px-6 pt-2 no-scrollbar">
                          {TABS.map((t) => {
                            const active = t.id === activeTab;
                            return (
                              <button
                                key={t.id}
                                onClick={() => setActiveTab(t.id)}
                                className={active
                                  ? 'flex shrink-0 items-center gap-2 text-white border-b-2 border-white pb-3 font-medium text-sm transition-all'
                                  : 'flex shrink-0 items-center gap-2 text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent pb-3 text-sm transition-all'
                                }
                              >
                                <t.icon className="h-4 w-4" />
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="p-6 min-w-0">
                          <AnimatePresence mode="wait">
                            <motion.div
                              key={activeTab}
                              initial={{ opacity: 0, x: 16 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0, x: -16 }}
                              transition={{ duration: 0.25 }}
                              className="w-full min-w-0"
                            >
                              {activeTab === 'velocity' && <VelocityTab data={data} />}
                              {activeTab === 'issues' && <IssuesTab data={data} />}
                              {activeTab === 'contributors' && <ContributorsTab data={data} />}
                              {activeTab === 'languages' && <LanguagesTab data={data} />}
                            </motion.div>
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <Footer />

      <AnimatePresence>
        {reportOpen && (
          <ReportModal
            text={reportText}
            copied={copied}
            onCopy={copyReport}
            onDownload={downloadReport}
            onClose={() => setReportOpen(false)}
            onSaveToStorage={saveToStorage}
            canSaveToStorage={!!user}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {authModalOpen && (
          <AuthModal
            onClose={() => setAuthModalOpen(false)}
            onAuthed={() => {
              setAuthModalOpen(false);
              showToast('Signed in successfully');
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {profileOpen && (
          <ProfileModal
            onClose={() => setProfileOpen(false)}
            showToast={showToast}
            initialTab={profileInitialTab}
            onBookmarkChanged={refreshBookmarks}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            onClose={() => setSettingsOpen(false)}
            onSaved={() => {
              setSettingsOpen(false);
              showToast('API token saved — limit increased to 5,000/hr');
              if (activeRepo) load(activeRepo);
            }}
          />
        )}
      </AnimatePresence>

      <Toast message={toast} />
    </div>
  );
}

/* ---------- Hero Section ---------- */
function HeroSection({
  input, setInput, onSubmit, onSelectPreset, searchInputRef,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onSelectPreset: (r: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center py-16"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mb-6 flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-400 backdrop-blur-sm"
      >
        <Zap className="h-3.5 w-3.5 text-indigo-400" />
        Instant GitHub analytics — no setup required
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="text-center text-4xl font-semibold tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl"
      >
        Analyze{' '}
        <span className="bg-gradient-to-r from-indigo-400 via-indigo-300 to-blue-400 bg-clip-text text-transparent">
          GitHub Repositories
        </span>{' '}
        in Seconds.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-4 max-w-xl text-center text-base text-zinc-400 sm:text-lg"
      >
        Actionable codebase health, commit velocity, and contributor insights.
      </motion.p>

      <motion.form
        onSubmit={onSubmit}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-8 w-full max-w-xl mx-auto"
      >
        <div className="group relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500 transition-colors group-focus-within:text-indigo-400" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search public repo (e.g. facebook/react)..."
            ref={searchInputRef}
            autoFocus
            className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 py-4 pl-12 pr-32 text-base text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 active:scale-95"
          >
            Analyze
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </motion.form>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
        className="mt-8 flex flex-wrap items-center justify-center gap-2"
      >
        <span className="text-xs text-zinc-600">Try:</span>
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onSelectPreset(p)}
            className="group flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-medium text-zinc-400 backdrop-blur-sm transition hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <Github className="h-3 w-3" />
            {p}
          </button>
        ))}
      </motion.div>
    </motion.div>
  );
}

/* ---------- Header ---------- */
function Header({
  input, setInput, onSubmit, showSearch, rateLimit,
  user, authLoading, onOpenAuth, onOpenProfile, onOpenProfileAudits, onSignOut, onOpenSettings, hasToken,
  searchInputRef, onLogoClick,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  showSearch: boolean;
  rateLimit: { remaining: number; limit: number; reset: number } | null;
  user: User | null;
  authLoading: boolean;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onOpenProfileAudits: () => void;
  onSignOut: () => void;
  onOpenSettings: () => void;
  hasToken: boolean;
  searchInputRef: React.RefObject<HTMLInputElement>;
  onLogoClick: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = user?.email?.[0]?.toUpperCase() ?? '?';
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl+K';

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/50 glass">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8">
        <div className="relative flex items-center justify-between w-full flex-wrap gap-y-3">
          {/* Left Column — Logo + tagline (clickable → home) */}
          <div className="flex items-center">
            <button
              onClick={onLogoClick}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity cursor-pointer"
            >
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-zinc-800 bg-zinc-900">
                <LogoIcon className="h-5 w-5" />
              </div>
              <div className="hidden sm:block text-left">
                <h1 className="text-base font-semibold leading-none tracking-tight text-zinc-100">
                  GitDeck
                </h1>
                <p className="text-[10px] text-zinc-500 mt-0.5">Repository Intelligence</p>
              </div>
            </button>
          </div>

          {/* Center Column — Search bar (absolute centered on desktop) */}
          {showSearch && (
            <form
              onSubmit={onSubmit}
              className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-full max-w-md lg:max-w-lg"
            >
              <div className="group relative w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 group-focus-within:text-zinc-300 transition-colors" />
                <input
                  id="global-search-input"
                  ref={searchInputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Search public repo (e.g. facebook/react)..."
                  className="h-9 w-full rounded-xl border border-zinc-800 bg-zinc-900/60 pl-10 pr-20 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-indigo-500/20"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 sm:flex">
                  {shortcutLabel}
                </kbd>
              </div>
            </form>
          )}

          {/* Mobile search — full-width row below */}
          {showSearch && (
            <form onSubmit={onSubmit} className="md:hidden order-3 w-full flex justify-center">
              <div className="group relative w-full max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500 group-focus-within:text-zinc-300 transition-colors" />
                <input
                  id="global-search-input"
                  ref={searchInputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Search public repo (e.g. facebook/react)..."
                  className="h-9 w-full rounded-xl border border-zinc-800 bg-zinc-900/60 pl-10 pr-20 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </form>
          )}

          {/* Right Column — Controls */}
          <div className="flex justify-end items-center gap-2 sm:gap-4">
            {/* Rate limit pill — clickable to open API token settings */}
            {rateLimit && (
              <button
                onClick={onOpenSettings}
                title="Click to set PAT & expand quota to 5,000 req/hr"
                className={`relative flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] transition-colors hover:bg-zinc-800 cursor-pointer ${
                  hasToken
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                {rateLimit.remaining}/{rateLimit.limit}
                {hasToken && (
                  <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
                )}
              </button>
            )}

            {/* Auth area */}
            {authLoading ? (
              <div className="h-9 w-9 rounded-xl bg-zinc-900 animate-pulse" />
            ) : user ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 pl-1 pr-2 transition hover:bg-zinc-800"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-xs font-semibold text-zinc-100">
                    {initial}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                </button>
                <AnimatePresence>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.96 }}
                        className="absolute right-0 top-full mt-2 z-50 w-52 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                      >
                        <div className="border-b border-zinc-800 px-3 py-2.5">
                          <p className="text-[11px] text-zinc-500">Signed in as</p>
                          <p className="truncate text-sm text-zinc-100">{user.email}</p>
                        </div>
                        <button
                          onClick={() => { setMenuOpen(false); onOpenProfile(); }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800"
                        >
                          <UserIcon className="h-4 w-4 text-zinc-400" /> My Profile
                        </button>
                        <button
                          onClick={() => { setMenuOpen(false); onOpenProfileAudits(); }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800"
                        >
                          <Archive className="h-4 w-4 text-zinc-400" /> Saved Audits
                        </button>
                        <div className="border-t border-zinc-800">
                          <button
                            onClick={() => { setMenuOpen(false); onSignOut(); }}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-zinc-200 transition hover:bg-zinc-800"
                          >
                            <LogOut className="h-4 w-4 text-zinc-400" /> Sign Out
                          </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <button
                onClick={onOpenAuth}
                className="flex h-9 items-center rounded-xl border border-zinc-700 bg-zinc-100 px-3 text-xs font-medium text-black transition hover:bg-white active:scale-95"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/* ---------- Preset Bar ---------- */
function PresetBar({
  activeRepo, onSelect, bookmarks, user,
}: {
  activeRepo: string;
  onSelect: (r: string) => void;
  bookmarks: string[];
  user: User | null;
}) {
  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center text-xs text-zinc-500 mr-1">
          <Zap className="h-4 w-4 text-zinc-500 inline mr-1.5" />
          Quick select:
        </span>
        {PRESETS.map((p) => {
          const active = p === activeRepo;
          return (
            <button
              key={p}
              onClick={() => onSelect(p)}
              className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? 'border-zinc-600 bg-zinc-100 text-black'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
              }`}
            >
              <Github className="h-3 w-3" />
              {p}
            </button>
          );
        })}
      </div>

      {user && bookmarks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-zinc-500 mr-1">
            <Bookmark className="h-3 w-3" /> My Bookmarks:
          </span>
          {bookmarks.map((b) => {
            const active = b === activeRepo;
            return (
              <button
                key={b}
                onClick={() => onSelect(b)}
                className={`group flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                }`}
              >
                <Bookmark className="h-3 w-3" />
                {b}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Vitals Banner ---------- */
function VitalsBanner({
  repo, data, isBookmarked, onBookmark, bookmarking, onExport, canExport,
}: {
  repo: RepoData;
  data: FetchResult;
  isBookmarked: boolean;
  onBookmark: () => void;
  bookmarking: boolean;
  onExport: () => void;
  canExport: boolean;
}) {
  const hs = useMemo(() => healthScore(data.commits, data.issues), [data.commits, data.issues]);
  const release = data.release;
  const scoreColor =
    hs.label === 'Very High' ? 'text-emerald-400'
      : hs.label === 'High' ? 'text-emerald-400'
      : hs.label === 'Moderate' ? 'text-amber-400'
      : 'text-rose-400';
  const scoreBg =
    hs.label === 'Very High' ? 'border-emerald-500/30 bg-emerald-500/10'
      : hs.label === 'High' ? 'border-emerald-500/30 bg-emerald-500/10'
      : hs.label === 'Moderate' ? 'border-amber-500/30 bg-amber-500/10'
      : 'border-rose-500/30 bg-rose-500/10';
  const dotColor =
    hs.label === 'Very High' ? 'bg-emerald-400'
      : hs.label === 'High' ? 'bg-emerald-400'
      : hs.label === 'Moderate' ? 'bg-amber-400'
      : 'bg-rose-400';
  const vitals = [
    { icon: Star, label: 'Stars', value: formatNumber(repo.stargazers_count) },
    { icon: GitFork, label: 'Forks', value: formatNumber(repo.forks_count) },
    { icon: AlertCircle, label: 'Open Issues', value: formatNumber(repo.open_issues_count) },
    { icon: Eye, label: 'Watchers', value: formatNumber(repo.watchers_count) },
    { icon: Scale, label: 'License', value: repo.license?.spdx_id ?? 'None' },
    { icon: Code2, label: 'Language', value: repo.language ?? '—' },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4 min-w-0">
          <img
            src={repo.owner.avatar_url}
            alt={repo.owner.login}
            className="h-14 w-14 rounded-xl border border-zinc-800 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={repo.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-lg font-semibold tracking-tight text-zinc-100 hover:text-white transition truncate"
                >
                  {repo.full_name}
                </a>
                <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400">
                  {repo.default_branch}
                </span>
                <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${scoreBg}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dotColor} animate-pulse`} />
                  <span className="text-zinc-300">Health Score:</span>
                  <span className={`font-semibold ${scoreColor}`}>{hs.score}/100</span>
                  <span className="text-zinc-500">— {hs.activity}</span>
                </span>
                {release ? (
                  <a
                    href={release.html_url}
                    target="_blank"
                    rel="noreferrer"
                    title="Latest release"
                    className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800"
                  >
                    <Tag className="h-3 w-3 text-indigo-400" />
                    {release.tag_name}
                    <span className="text-zinc-500">· {timeAgo(release.published_at)}</span>
                  </a>
                ) : (
                  <span className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
                    <GitBranch className="h-3 w-3" />
                    {repo.default_branch}
                  </span>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={onBookmark}
                  disabled={bookmarking}
                  title={isBookmarked ? 'Remove bookmark' : 'Bookmark this repo'}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-all disabled:opacity-50 ${
                    isBookmarked
                      ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                      : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {bookmarking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Star className={`h-4 w-4 ${isBookmarked ? 'fill-amber-400 text-amber-400' : ''}`} />
                  )}
                </button>
                <button
                  onClick={onExport}
                  disabled={!canExport}
                  title="Export audit report"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Download className="h-4 w-4" />
                </button>
              </div>
            </div>
            {repo.description && (
              <p className="mt-1 text-sm text-zinc-400 line-clamp-2 max-w-2xl">
                {repo.description}
              </p>
            )}
            <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Updated {timeAgo(repo.pushed_at)}
              </span>
              {repo.topics && repo.topics.length > 0 && (
                <span className="hidden sm:flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  {repo.topics.slice(0, 3).join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 w-full p-6 border-t border-zinc-800/50">
        {vitals.map((v) => (
          <div key={v.label} className="flex flex-col p-4 rounded-xl border border-transparent hover:border-white/5 hover:bg-white/[0.02] transition-all duration-200">
            <div className="flex items-center gap-1.5 text-sm text-zinc-400 font-medium mb-1.5">
              <v.icon className="h-3.5 w-3.5 text-zinc-400" />
              {v.label}
            </div>
            <div className="text-2xl font-semibold text-white tracking-tight truncate">
              {v.value}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/* ---------- Card ---------- */
function Card({
  title, icon: Icon, children, className = '',
}: {
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-sm p-5 overflow-hidden min-w-0 ${className}`}>
      {title && (
        <div className="mb-4 flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-zinc-300" />}
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------- Tab 1: Velocity ---------- */
function VelocityTab({ data }: { data: FetchResult }) {
  const timeline = useMemo(() => commitTimeline(data.commits), [data.commits]);
  const authors = useMemo(() => authorDistribution(data.commits), [data.commits]);
  const recent = useMemo(() => recentCommits(data.commits), [data.commits]);

  if (!data.repo || data.commits.length === 0) {
    return <ChartEmptyState icon={Activity} message="No commit activity found for this repository." />;
  }

  const repo = data.repo;

  const authorChartData = authors.map((a) => ({
    name: a.login, value: a.count, avatar: a.avatar,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Commit Timeline" icon={TrendingUp} className="lg:col-span-2">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeline} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="commitGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.25} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="date" stroke="#52525b" fontSize={11} tickMargin={8} />
              <YAxis stroke="#52525b" fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: '#e4e4e7' }} />
              <Line
                type="monotone" dataKey="count" stroke="url(#commitGrad)"
                strokeWidth={2.5} dot={{ r: 3, fill: '#818cf8', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#818cf8', stroke: '#09090b', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Top Authors" icon={Users}>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={authorChartData} layout="vertical" margin={{ left: 20, right: 12 }}>
              <defs>
                <linearGradient id="authorGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={1} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0.8} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
              <XAxis type="number" stroke="#52525b" fontSize={11} allowDecimals={false} />
              <YAxis type="category" dataKey="name" stroke="#52525b" fontSize={11} width={90} />
              <Tooltip contentStyle={{ ...TOOLTIP_STYLE, padding: '8px 12px' }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="url(#authorGrad)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Recent Commits" icon={GitCommitHorizontal}>
        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {recent.map((c) => {
            const author = c.author?.login ?? c.commit.author.name;
            const avatar = c.author?.avatar_url;
            const msg = c.commit.message.split('\n')[0];
            const commitUrl = `https://github.com/${repo.full_name}/commit/${c.sha}`;
            return (
              <a
                key={c.sha}
                href={commitUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 rounded-lg p-2.5 transition hover:bg-zinc-900/50 cursor-pointer"
              >
                {avatar ? (
                  <img src={avatar} alt={author} className="h-7 w-7 rounded-full border border-zinc-800 shrink-0" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-zinc-800 grid place-items-center text-[10px] text-zinc-300 shrink-0">
                    {author.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 truncate group-hover:text-white">{msg}</p>
                  <p className="text-[11px] text-zinc-500">
                    @{author} · {timeAgo(c.commit.author.date)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-zinc-600 shrink-0 mt-1" />
              </a>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Tab 2: Issues & PRs ---------- */
function IssuesTab({ data }: { data: FetchResult }) {
  const stats = useMemo(() => issueStats(data.issues), [data.issues]);

  if (data.issues.length === 0) {
    return <ChartEmptyState icon={AlertCircle} message="No issues or pull requests found for this repository." />;
  }

  const issuePie = [
    { name: 'Open Issues', value: stats.openIssues.length, color: '#f87171' },
    { name: 'Closed Issues', value: stats.closedIssues.length, color: '#a1a1aa' },
  ];
  const prPie = [
    { name: 'Open PRs', value: stats.openPrs.length, color: '#818cf8' },
    { name: 'Closed/Merged PRs', value: stats.closedPrs.length, color: '#71717a' },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Issue Distribution" icon={AlertCircle}>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={issuePie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {issuePie.map((e) => (
                  <Cell key={e.name} fill={e.color} stroke="#09090b" />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-zinc-300">{v}</span>} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Pull Request Breakdown" icon={GitFork}>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={prPie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {prPie.map((e) => (
                  <Cell key={e.name} fill={e.color} stroke="#09090b" />
                ))}
              </Pie>
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-zinc-300">{v}</span>} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Open Issues" value={stats.openIssues.length} icon={AlertCircle} />
          <Stat label="Closed Issues" value={stats.closedIssues.length} icon={CheckCircle2} />
          <Stat label="Open Ratio" value={`${stats.openRatio.toFixed(0)}%`} icon={TrendingUp} />
          <Stat label="Avg Age (open)" value={`${stats.avgAgeOpen}d`} icon={Clock} />
        </div>
      </Card>

      <CommunityStandardsCard community={data.community} />

      <ExecutiveHealthInsightsCard data={data} />
    </div>
  );
}

function Stat({
  label, value, icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex flex-col p-4 rounded-xl border border-transparent hover:border-white/5 hover:bg-white/[0.02] transition-all duration-200">
      <div className="flex items-center gap-1.5 text-sm text-zinc-400 font-medium mb-1.5">
        <Icon className="h-3.5 w-3.5 text-zinc-400" />
        {label}
      </div>
      <div className="text-2xl font-semibold text-white tracking-tight truncate">{value}</div>
    </div>
  );
}

/* ---------- Community Standards Card ---------- */
function CommunityStandardsCard({ community }: { community: CommunityProfile | null }) {
  const items = useMemo(() => {
    if (!community?.files) return [];
    return [
      { label: 'Code of Conduct', ok: community.files.code_of_conduct, icon: Heart },
      { label: 'Contributing Guide', ok: community.files.contributing, icon: FileText },
      { label: 'Issue Templates', ok: community.files.issue_template, icon: AlertCircle },
      { label: 'PR Template', ok: community.files.pull_request_template, icon: GitPullRequest },
      { label: 'License', ok: community.files.license, icon: Scale },
      { label: 'README', ok: community.files.readme, icon: BookOpen },
    ];
  }, [community]);

  const pct = community?.health_percentage ?? 0;
  const ringColor =
    pct >= 80 ? '#34d399' : pct >= 50 ? '#fbbf24' : '#f87171';
  const circumference = 2 * Math.PI * 32;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <Card title="Community Standards" icon={Heart} className="lg:col-span-2">
      {!community ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Heart className="h-8 w-8 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">
            Community profile data is not available for this repository.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          {/* Circular progress ring */}
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="relative h-20 w-20">
              <svg className="h-20 w-20 -rotate-90" viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="32" fill="none" stroke="#27272a" strokeWidth="6" />
                <circle
                  cx="36" cy="36" r="32" fill="none"
                  stroke={ringColor} strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-semibold text-white">{pct}%</span>
              </div>
            </div>
            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">Health</span>
          </div>

          {/* Checklist grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 w-full">
            {items.map((item) => {
              const present = item.ok === true;
              return (
                <div
                  key={item.label}
                  className={present
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-lg p-3 flex items-center gap-2 text-sm'
                    : 'bg-zinc-900/50 border border-zinc-800/60 text-zinc-400 rounded-lg p-3 flex items-center gap-2 text-sm'
                  }
                >
                  {present ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-zinc-500" />
                  )}
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Executive Health Insights Card ---------- */
function ExecutiveHealthInsightsCard({ data }: { data: FetchResult }) {
  const insights = useMemo(() => {
    const hs = healthScore(data.commits, data.issues);
    const bf = data.contributors.length > 0 ? busFactor(data.contributors) : null;
    const stats = data.issues.length > 0 ? issueStats(data.issues) : null;
    const recentCommitCount = data.commits.length;
    const topSharePct = bf ? (bf.topShare * 100).toFixed(0) : '0';

    const velocityLevel =
      recentCommitCount >= 100 ? 'High'
        : recentCommitCount >= 30 ? 'Moderate'
        : recentCommitCount > 0 ? 'Low'
        : 'Stale';
    const velocityDetail =
      recentCommitCount > 0
        ? `${recentCommitCount} recent commit${recentCommitCount !== 1 ? 's' : ''}`
        : 'No recent commits detected';

    const busLevel =
      !bf ? 'Unknown'
        : bf.label === 'Critical' || bf.label === 'High' ? 'High Risk'
        : bf.label === 'Moderate' ? 'Moderate Risk'
        : 'Low Risk';
    const busDetail = bf
      ? `Top author holds ${topSharePct}% of commits`
      : 'No contributor data available';

    const issueLevel =
      !stats ? 'Unknown'
        : stats.avgAgeOpen <= 7 ? 'Fast'
        : stats.avgAgeOpen <= 30 ? 'Moderate'
        : 'Slow';
    const issueDetail =
      stats && stats.openIssues.length > 0
        ? `${stats.openIssues.length} open, avg age ${stats.avgAgeOpen}d`
        : stats
          ? 'No open issues remaining'
          : 'No issue data available';

    return [
      {
        icon: Zap,
        label: 'Maintenance Velocity',
        level: velocityLevel,
        detail: velocityDetail,
        color: velocityLevel === 'High' ? 'text-emerald-400'
          : velocityLevel === 'Moderate' ? 'text-amber-400'
          : 'text-rose-400',
      },
      {
        icon: ShieldAlert,
        label: 'Bus Factor',
        level: busLevel,
        detail: busDetail,
        color: busLevel === 'Low Risk' ? 'text-emerald-400'
          : busLevel === 'Moderate Risk' ? 'text-amber-400'
          : 'text-rose-400',
      },
      {
        icon: Clock,
        label: 'Issue Resolution',
        level: issueLevel,
        detail: issueDetail,
        color: issueLevel === 'Fast' ? 'text-emerald-400'
          : issueLevel === 'Moderate' ? 'text-amber-400'
          : 'text-rose-400',
      },
    ];
  }, [data]);

  return (
    <Card title="Executive Health Insights" icon={Sparkles} className="lg:col-span-2">
      <div className="flex flex-col gap-3">
        {insights.map((insight, i) => (
          <motion.div
            key={insight.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700/50 bg-zinc-800/50">
              <insight.icon className={`h-4 w-4 ${insight.color}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium text-zinc-200">{insight.label}</span>
                <span className={`text-xs font-semibold ${insight.color}`}>{insight.level}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-zinc-500">{insight.detail}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

/* ---------- Tab 3: Contributors ---------- */
function ContributorsTab({ data }: { data: FetchResult }) {
  const bf = useMemo(() => busFactor(data.contributors), [data.contributors]);
  const total = useMemo(
    () => data.contributors.reduce((s, c) => s + c.contributions, 0),
    [data.contributors]
  );

  if (data.contributors.length === 0) {
    return <ChartEmptyState icon={Users} message="No contributor data available for this repository." />;
  }

  const riskColor =
    bf.label === 'Critical' ? 'text-rose-400'
      : bf.label === 'High' ? 'text-amber-400'
      : bf.label === 'Moderate' ? 'text-yellow-400'
      : 'text-zinc-300';
  const riskBg =
    bf.label === 'Critical' ? 'from-rose-500/10 to-transparent border-rose-500/30'
      : bf.label === 'High' ? 'from-amber-500/10 to-transparent border-amber-500/30'
      : bf.label === 'Moderate' ? 'from-yellow-500/10 to-transparent border-yellow-500/30'
      : 'from-zinc-500/10 to-transparent border-zinc-700';
  const riskBar =
    bf.label === 'Critical' ? 'bg-rose-500'
      : bf.label === 'High' ? 'bg-amber-500'
      : bf.label === 'Moderate' ? 'bg-yellow-500'
      : 'bg-zinc-300';

  const topContributors = data.contributors.slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 overflow-x-auto no-scrollbar py-2">
        {topContributors.map((c, i) => (
          <a
            key={c.login}
            href={c.html_url}
            target="_blank"
            rel="noreferrer"
            title={`@${c.login} — ${formatNumber(c.contributions)} commits`}
            className="group relative shrink-0"
          >
            <img
              src={c.avatar_url}
              alt={c.login}
              className={`h-11 w-11 rounded-full border-2 transition-all group-hover:scale-110 ${
                i === 0 ? 'border-amber-400/60' : 'border-zinc-700 group-hover:border-zinc-500'
              }`
              }
            />
            {i === 0 && (
              <span className="absolute top-0 left-0 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-black ring-2 ring-zinc-950">
                1
              </span>
            )}
          </a>
        ))}
        {data.contributors.length > 8 && (
          <span className="shrink-0 pl-1 text-xs text-zinc-500">
            +{data.contributors.length - 8} more
          </span>
        )}
      </div>

      <div className={`rounded-2xl border bg-gradient-to-br p-5 backdrop-blur-sm ${riskBg}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <ShieldAlert className={`h-6 w-6 ${riskColor}`} />
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">Bus Factor Risk Score</h3>
              <p className="text-[11px] text-zinc-500">
                Concentration of contribution ownership
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className={`tracking-tight font-bold text-3xl ${riskColor}`}>{bf.score}<span className="text-base text-zinc-600">/100</span></div>
            <div className={`text-xs font-medium ${riskColor}`}>{bf.label} Risk</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Top Contributor</div>
            <div className="text-sm font-medium text-zinc-100 truncate">@{bf.topContributor}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Top Share</div>
            <div className="text-sm font-medium text-zinc-100">{(bf.topShare * 100).toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Contributors</div>
            <div className="text-sm font-medium text-zinc-100">{bf.totalContributors}</div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full ${riskBar}`}
            style={{ width: `${bf.score}%` }}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.contributors.slice(0, 12).map((c, i) => {
          const share = total ? (c.contributions / total) * 100 : 0;
          return (
            <motion.a
              key={c.login}
              href={c.html_url}
              target="_blank"
              rel="noreferrer"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              className="group block rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 backdrop-blur-sm transition hover:border-zinc-700 hover:bg-zinc-900"
            >
              <div className="flex items-center gap-3">
                <img src={c.avatar_url} alt={c.login} className="h-10 w-10 rounded-full border border-zinc-800" />
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-zinc-100 group-hover:text-white truncate block">
                    @{c.login}
                  </span>
                  <p className="text-[11px] text-zinc-500">{c.type}</p>
                </div>
                {i === 0 && (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-black">
                    #1
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-400">
                <span>{formatNumber(c.contributions)} commits</span>
                <span className="text-zinc-500">{share.toFixed(1)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-zinc-300"
                  style={{ width: `${Math.max(2, share)}%` }}
                />
              </div>
            </motion.a>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Tab 4: Languages ---------- */
function LanguagesTab({ data }: { data: FetchResult }) {
  const entries = useMemo(
    () => Object.entries(data.languages).sort((a, b) => b[1] - a[1]),
    [data.languages]
  );
  const total = useMemo(
    () => entries.reduce((s, [, v]) => s + v, 0),
    [entries]
  );

  if (entries.length === 0) {
    return <ChartEmptyState icon={Code2} message="No language data available for this repository." />;
  }

  const pieData = entries.map(([name, value]) => ({
    name, value, color: languageColor(name),
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card title="Language Distribution" icon={Code2}>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={110} paddingAngle={2}>
                {pieData.map((e) => (
                  <Cell key={e.name} fill={e.color} stroke="#09090b" />
                ))}
              </Pie>
              <Legend
                wrapperStyle={{ fontSize: 11 }}
                formatter={(value) => <span className="text-zinc-300">{value}</span>}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value) => `${((Number(value) / total) * 100).toFixed(1)}%`}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Breakdown" icon={FileCode2}>
        <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
          {entries.map(([name, bytes]) => {
            const pct = (bytes / total) * 100;
            return (
              <div key={name}>
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-zinc-200">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: languageColor(name) }} />
                    {name}
                  </span>
                  <span className="text-zinc-400">{pct.toFixed(1)}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: languageColor(name) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <DependenciesCard deps={data.dependencies} className="lg:col-span-2" />

      <Card className="lg:col-span-2">
        <div className="flex h-4 w-full overflow-hidden rounded-full border border-zinc-800">
          {entries.map(([name, bytes]) => {
            const pct = (bytes / total) * 100;
            if (pct < 0.5) return null;
            return (
              <div
                key={name}
                style={{ width: `${pct}%`, background: languageColor(name) }}
                title={`${name} ${pct.toFixed(1)}%`}
                className="h-full transition-all hover:brightness-125"
              />
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ---------- Dependencies Card ---------- */
function DependenciesCard({ deps, className = '' }: { deps: FetchResult['dependencies']; className?: string }) {
  const depEntries = useMemo(
    () => Object.entries(deps?.dependencies ?? {}),
    [deps]
  );
  const devEntries = useMemo(
    () => Object.entries(deps?.devDependencies ?? {}),
    [deps]
  );

  if (!deps?.hasPackageJson) {
    return (
      <Card title="Core Dependencies" icon={Package} className={className}>
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Package className="h-8 w-8 text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-500">
            No package.json found — this may not be a JavaScript/TypeScript project.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Core Dependencies" icon={Package} className={className}>
      <div className="space-y-4">
        {depEntries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Dependencies</p>
            <div className="flex flex-wrap gap-2">
              {depEntries.map(([name, version]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/50 px-3 py-1 text-sm text-zinc-300 transition hover:bg-zinc-800/80"
                >
                  {name}
                  <span className="text-zinc-500">{version.replace(/[\^~]/, '')}</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {devEntries.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Dev Dependencies</p>
            <div className="flex flex-wrap gap-2">
              {devEntries.slice(0, 20).map(([name, version]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800/30 px-3 py-1 text-sm text-zinc-400 transition hover:bg-zinc-800/50"
                >
                  {name}
                  <span className="text-zinc-600">{version.replace(/[\^~]/, '')}</span>
                </span>
              ))}
              {devEntries.length > 20 && (
                <span className="inline-flex items-center rounded-full bg-zinc-800/20 px-3 py-1 text-sm text-zinc-500">
                  +{devEntries.length - 20} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ---------- Auth Modal ---------- */
function AuthModal({
  onClose, onAuthed,
}: {
  onClose: () => void;
  onAuthed: () => void;
}) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const result = await fn(email, password);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
    } else {
      onAuthed();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] sm:w-full sm:max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <LogoIcon className="h-4 w-4" />
            <h3 className="text-sm font-semibold text-zinc-100">
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100 transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-zinc-500">Email</label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] text-zinc-500">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>
          {error && (
            <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-sm font-medium text-black transition hover:bg-zinc-200 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
          <p className="text-center text-xs text-zinc-500">
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="font-medium text-zinc-300 hover:text-white transition"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </form>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Profile Modal — Premium Glassmorphic Command Center ---------- */
function ProfileModal({
  onClose, showToast, initialTab = 'bookmarks', onBookmarkChanged,
}: {
  onClose: () => void;
  showToast: (msg: string) => void;
  initialTab?: 'bookmarks' | 'audits';
  onBookmarkChanged?: () => void;
}) {
  const { user, signOut } = useAuth();
  const [reports, setReports] = useState<ArchivedReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [bookmarkItems, setBookmarkItems] = useState<string[]>([]);
  const [segment, setSegment] = useState<'bookmarks' | 'audits'>(initialTab);

  const refreshAll = useCallback(async () => {
    const [r, b] = await Promise.all([
      listArchivedReports(),
      supabase.from('bookmarks').select('id, repo_full_name').order('created_at', { ascending: false }),
    ]);
    setReports(r);
    if (!b.error && b.data) setBookmarkItems(b.data.map((x) => x.repo_full_name));
    setLoadingReports(false);
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const downloadReport = async (path: string, fileName: string) => {
    const text = await downloadArchivedReport(path);
    if (text === null) {
      showToast('Failed to download report.');
      return;
    }
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteBookmark = async (repoName: string) => {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('repo_full_name', repoName);
    if (!error) {
      setBookmarkItems((prev) => prev.filter((b) => b !== repoName));
      onBookmarkChanged?.();
      showToast('Bookmark removed');
    }
  };

  const deleteReport = async (id: string, path: string) => {
    const [dbRes] = await Promise.all([
      supabase.from('audit_reports').delete().eq('id', id),
      supabase.storage.from('gitdeck-audits').remove([path]),
    ]);
    if (!dbRes.error) {
      setReports((prev) => prev.filter((r) => r.id !== id));
      showToast('Audit report deleted');
    } else {
      showToast('Failed to delete report.');
    }
  };

  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] sm:w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/90 backdrop-blur-2xl shadow-2xl p-5"
      >
        {/* Header: avatar + email */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-zinc-700 to-zinc-900 text-base font-semibold text-zinc-100">
              {initial}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium tracking-tight text-white truncate">{user?.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100 transition shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Segmented control */}
        <div className="mt-5 flex gap-1 rounded-xl border border-white/10 bg-zinc-900/50 p-1">
          {([
            { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark, count: bookmarkItems.length },
            { id: 'audits', label: 'Saved Audits', icon: Archive, count: reports.length },
          ] as const).map((seg) => {
            const active = segment === seg.id;
            return (
              <button
                key={seg.id}
                onClick={() => setSegment(seg.id)}
                className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition ${
                  active ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {active && (
                  <motion.div
                    layoutId="profile-seg"
                    className="absolute inset-0 rounded-lg bg-white/10"
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  />
                )}
                <seg.icon className="relative h-3.5 w-3.5" />
                <span className="relative">{seg.label}</span>
                {seg.count > 0 && (
                  <span className="relative rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    {seg.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <div className="mt-4 max-h-[48vh] min-h-[200px] overflow-y-auto">
          <AnimatePresence mode="wait">
            {segment === 'bookmarks' && (
              <motion.div
                key="bookmarks"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.2 }}
              >
                {bookmarkItems.length === 0 ? (
                  <ProfileEmptyState icon={Bookmark} message="No saved bookmarks yet" />
                ) : (
                  <div className="space-y-1">
                    {bookmarkItems.map((b) => (
                      <div
                        key={b}
                        className="group flex items-center justify-between rounded-xl p-3 transition-all hover:bg-white/5"
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Github className="h-4 w-4 text-zinc-600 shrink-0" />
                          <span className="truncate text-sm text-zinc-200">{b}</span>
                        </span>
                        <button
                          onClick={() => deleteBookmark(b)}
                          className="shrink-0 text-zinc-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {segment === 'audits' && (
              <motion.div
                key="audits"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2 }}
              >
                {loadingReports ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                  </div>
                ) : reports.length === 0 ? (
                  <ProfileEmptyState icon={Archive} message="No saved audits yet" />
                ) : (
                  <div className="space-y-1">
                    {reports.map((r) => (
                      <div
                        key={r.id}
                        className="group flex items-center justify-between rounded-xl p-3 transition-all hover:bg-white/5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-zinc-200">{r.repo_full_name}</p>
                          <p className="text-[11px] text-zinc-600">
                            {timeAgo(r.created_at)}
                            {r.health_score !== null && ` · Score ${r.health_score}/100`}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                          <button
                            onClick={() => downloadReport(r.storage_path, r.file_name)}
                            className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => deleteReport(r.id, r.storage_path)}
                            className="grid h-7 w-7 place-items-center rounded-md text-zinc-600 transition hover:bg-rose-500/10 hover:text-rose-400"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Sign Out button — premium filled danger state */}
        <button
          onClick={async () => {
            try { await signOut(); } catch { /* session clears locally regardless */ }
            onClose();
            showToast('Signed out');
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 mt-4 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-600 hover:text-white transition-all font-medium"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Settings Modal ---------- */
function SettingsModal({
  onClose, onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = getStoredToken();
    if (existing) setToken(existing);
  }, []);

  const save = () => {
    setStoredToken(token.trim() || null);
    setSaved(true);
    setTimeout(() => onSaved(), 400);
  };

  const clear = () => {
    setStoredToken(null);
    setToken('');
    setSaved(true);
    setTimeout(() => onSaved(), 400);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] sm:w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-zinc-300" />
            <h3 className="text-sm font-semibold text-zinc-100">API Configuration</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100 transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div className="space-y-1.5">
            <label className="text-[11px] text-zinc-500">GitHub Personal Access Token (PAT)</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              className="w-full rounded-xl border border-zinc-800 bg-zinc-950 py-2.5 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-500">
            Unauthenticated requests are limited to 60/hr. Paste a GitHub PAT here to increase your limit to 5,000/hr. This token is stored locally in your browser.
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            {token && (
              <button
                onClick={clear}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
            <button
              onClick={save}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-medium text-black transition hover:bg-zinc-200"
            >
              {saved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
              {saved ? 'Saved' : 'Save Token'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ---------- Premium Skeleton Loading ---------- */
function SkeletonBox({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

function LoadingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="mt-6 space-y-4"
    >
      {/* Vitals banner skeleton */}
      <div className="overflow-hidden rounded-2xl border border-zinc-800/50">
        <div className="flex items-center gap-4 p-5 sm:p-6">
          <SkeletonBox className="h-14 w-14 !rounded-xl" />
          <div className="flex-1 space-y-2">
            <SkeletonBox className="h-5 w-48 !rounded-lg" />
            <SkeletonBox className="h-3 w-72 !rounded-lg" />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 w-full px-5 sm:px-6 pb-5 sm:pb-6 pt-4 border-t border-zinc-800/50">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col justify-center rounded-lg px-2 py-1.5">
              <SkeletonBox className="h-3 w-16 !rounded-lg" />
              <SkeletonBox className="mt-2 h-7 w-20 !rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-4 overflow-x-auto no-scrollbar border-b border-zinc-800/50 pb-px">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBox key={i} className="h-9 w-32 shrink-0 !rounded-lg" />
        ))}
      </div>

      {/* Chart skeletons */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonBox className="h-72" />
        <SkeletonBox className="h-72" />
      </div>
    </motion.div>
  );
}

/* ---------- 404 / Error State ---------- */
function ErrorState({
  message, isRateLimit, onAddToken,
}: {
  message: string;
  isRateLimit: boolean;
  onAddToken: () => void;
}) {
  const is404 = message.toLowerCase().includes('not found');

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 p-10 text-center backdrop-blur-sm"
    >
      {is404 ? (
        <Search className="h-10 w-10 text-zinc-600" />
      ) : (
        <AlertTriangle className="h-10 w-10 text-amber-400" />
      )}
      <h3 className="mt-4 text-lg font-semibold text-zinc-100">
        {is404
          ? 'Repository not found'
          : isRateLimit
            ? 'GitHub API Rate Limit Reached'
            : "Couldn't load repository"}
      </h3>
      <p className="mt-1 max-w-md text-sm text-zinc-400">
        {is404
          ? 'Please check the spelling or try a public repository.'
          : message}
      </p>
      {isRateLimit && (
        <button
          onClick={onAddToken}
          className="mt-5 flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm font-medium text-indigo-300 transition hover:bg-indigo-500/20"
        >
          <KeyRound className="h-4 w-4" /> Add API Token
        </button>
      )}
    </motion.div>
  );
}

/* ---------- Chart-level Empty State ---------- */
function ChartEmptyState({
  icon: Icon, message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50 p-12 text-center backdrop-blur-sm">
      <Icon className="h-8 w-8 text-zinc-600" />
      <p className="mt-3 text-sm text-zinc-400">{message}</p>
    </div>
  );
}

/* ---------- Profile Empty State (ghost icon) ---------- */
function ProfileEmptyState({
  icon: Icon, message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/5 bg-white/[0.02]">
        <Icon className="h-5 w-5 text-zinc-600" />
      </div>
      <p className="mt-3 text-xs text-zinc-600">{message}</p>
    </div>
  );
}

/* ---------- Footer ---------- */
function Footer() {
  return (
    <footer className="border-t border-zinc-800/50 py-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 sm:flex-row sm:px-6 lg:px-8">
        <p className="text-sm text-zinc-600">
          GitDeck — Repository Intelligence. Designed &amp; Built by{' '}
          <span className="text-zinc-400">Mire</span>.
        </p>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/mirepatel"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-600 transition hover:text-zinc-300"
            aria-label="GitHub Profile"
          >
            <GithubFilledIcon className="h-4 w-4" />
          </a>
          <a
            href="https://www.linkedin.com/in/mirepatel"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-600 transition hover:text-zinc-300"
            aria-label="LinkedIn Profile"
          >
            <LinkedinIcon className="h-4 w-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}

function GithubFilledIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedinIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.601 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

/* ---------- Export helpers ---------- */
function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function buildAuditJson(data: FetchResult): Record<string, unknown> {
  const repo = data.repo!;
  const hs = healthScore(data.commits, data.issues);
  const bf = busFactor(data.contributors);
  const stats = issueStats(data.issues);
  return {
    repository: {
      full_name: repo.full_name,
      html_url: repo.html_url,
      description: repo.description,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      open_issues: repo.open_issues_count,
      watchers: repo.watchers_count,
      language: repo.language,
      license: repo.license?.spdx_id ?? null,
      default_branch: repo.default_branch,
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
    },
    health: { score: hs.score, label: hs.label, activity: hs.activity },
    bus_factor: { score: bf.score, label: bf.label, top_contributor: bf.topContributor, top_share: bf.topShare },
    issues: {
      open: stats.openIssues.length,
      closed: stats.closedIssues.length,
      open_prs: stats.openPrs.length,
      closed_prs: stats.closedPrs.length,
      open_ratio: parseFloat(stats.openRatio.toFixed(1)),
      avg_age_open_days: stats.avgAgeOpen,
    },
    commits: {
      total_sampled: data.commits.length,
      unique_authors: new Set(data.commits.map((c) => c.author?.login ?? c.commit.author.name)).size,
      top_authors: authorDistribution(data.commits).slice(0, 5).map((a) => ({ login: a.login, count: a.count })),
      recent: recentCommits(data.commits, 5).map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0].slice(0, 80),
        author: c.author?.login ?? c.commit.author.name,
        date: c.commit.author.date,
      })),
    },
    contributors: data.contributors.slice(0, 10).map((c) => ({
      login: c.login, contributions: c.contributions, type: c.type,
    })),
    languages: Object.entries(data.languages)
      .sort((a, b) => b[1] - a[1])
      .map(([name, bytes]) => ({ name, bytes })),
    generated_at: new Date().toISOString(),
  };
}

function downloadPdf(data: FetchResult, markdown: string, baseName: string) {
  const repo = data.repo!;
  const hs = healthScore(data.commits, data.issues);
  const bf = busFactor(data.contributors);
  const stats = issueStats(data.issues);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - margin) { doc.addPage(); y = margin; }
  };
  const writeText = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number } = {}) => {
    const { size = 11, bold = false, color = [60, 60, 60], gap = 6 } = opts;
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    lines.forEach((line) => {
      ensureSpace(size + 4);
      doc.text(line, margin, y);
      y += size + 4;
    });
    y += gap;
  };

  writeText('GitDeck Health Audit Report', { size: 20, bold: true, color: [20, 20, 20], gap: 4 });
  writeText(`Repository: ${repo.full_name}`, { size: 13, bold: true, color: [80, 80, 80], gap: 2 });
  writeText(`Generated: ${new Date().toLocaleString()}`, { size: 10, color: [130, 130, 130], gap: 12 });

  writeText('Vitals', { size: 14, bold: true, color: [30, 30, 30], gap: 4 });
  const vitalsRows: [string, string][] = [
    ['Stars', String(repo.stargazers_count)],
    ['Forks', String(repo.forks_count)],
    ['Open Issues', String(repo.open_issues_count)],
    ['Watchers', String(repo.watchers_count)],
    ['License', repo.license?.spdx_id ?? 'None'],
    ['Main Language', repo.language ?? '—'],
    ['Default Branch', repo.default_branch],
  ];
  vitalsRows.forEach(([k, v]) => writeText(`  ${k}: ${v}`, { size: 11, gap: 2 }));
  y += 8;

  writeText(`Health Score: ${hs.score}/100 — ${hs.label} (${hs.activity})`, { size: 14, bold: true, color: [30, 30, 30], gap: 4 });
  writeText(`  Commit Frequency: ${data.commits.length} commits sampled`, { size: 11, gap: 2 });
  writeText(`  Issue Resolution: ${stats.closedIssues.length}/${stats.realIssues.length} closed`, { size: 11, gap: 12 });

  writeText('Issue & PR Health', { size: 14, bold: true, color: [30, 30, 30], gap: 4 });
  writeText(`  Open Issues: ${stats.openIssues.length}`, { size: 11, gap: 2 });
  writeText(`  Closed Issues: ${stats.closedIssues.length}`, { size: 11, gap: 2 });
  writeText(`  Open PRs: ${stats.openPrs.length}`, { size: 11, gap: 2 });
  writeText(`  Closed/Merged PRs: ${stats.closedPrs.length}`, { size: 11, gap: 12 });

  writeText('Contributor Network', { size: 14, bold: true, color: [30, 30, 30], gap: 4 });
  writeText(`  Total Contributors: ${data.contributors.length}`, { size: 11, gap: 2 });
  writeText(`  Top Contributor: @${bf.topContributor} (${(bf.topShare * 100).toFixed(1)}%)`, { size: 11, gap: 2 });
  writeText(`  Bus Factor Risk: ${bf.label} (${bf.score}/100)`, { size: 11, gap: 12 });

  writeText('Top Contributors', { size: 14, bold: true, color: [30, 30, 30], gap: 4 });
  data.contributors.slice(0, 10).forEach((c, i) => {
    writeText(`  ${i + 1}. @${c.login} — ${c.contributions} contributions`, { size: 11, gap: 2 });
  });
  y += 8;

  writeText('Language Distribution', { size: 14, bold: true, color: [30, 30, 30], gap: 4 });
  const langTotal = Object.values(data.languages).reduce((s, v) => s + v, 0);
  Object.entries(data.languages).sort((a, b) => b[1] - a[1]).forEach(([name, bytes]) => {
    const pct = ((bytes / langTotal) * 100).toFixed(1);
    writeText(`  ${name}: ${pct}%`, { size: 11, gap: 2 });
  });

  doc.addPage();
  y = margin;
  writeText('Full Markdown Report', { size: 16, bold: true, color: [20, 20, 20], gap: 8 });
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(50, 50, 50);
  const mdLines = markdown.split('\n');
  mdLines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line || ' ', contentW) as string[];
    wrapped.forEach((w) => {
      ensureSpace(12);
      doc.text(w, margin, y);
      y += 12;
    });
  });

  doc.save(`${baseName}-audit.pdf`);
}

/* ---------- Toast ---------- */
function Toast({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 shadow-2xl backdrop-blur-sm"
        >
          <div className="flex items-center gap-2 text-sm text-zinc-100">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- Report Modal ---------- */
function ReportModal({
  text, copied, onCopy, onDownload, onClose, onSaveToStorage, canSaveToStorage,
}: {
  text: string;
  copied: boolean;
  onCopy: () => void;
  onDownload: (format: 'md' | 'json' | 'pdf') => void;
  onClose: () => void;
  onSaveToStorage: () => void;
  canSaveToStorage: boolean;
}) {
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-[95vw] sm:w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div className="flex items-center gap-2">
            <FileCode2 className="h-4 w-4 text-zinc-300" />
            <h3 className="text-sm font-semibold text-zinc-100">GitDeck Health Audit Report</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-100 transition">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-4">
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-zinc-800 bg-black/40 p-4 text-[11px] leading-relaxed text-zinc-300 font-mono">
            {text}
          </pre>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 p-4">
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
            >
              <Download className="h-3.5 w-3.5" /> Export
              <ChevronDownIcon className="h-3 w-3 text-zinc-500" />
            </button>
            <AnimatePresence>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    className="absolute bottom-full mb-2 right-0 z-50 w-44 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
                  >
                    <button
                      onClick={() => { setExportOpen(false); onDownload('md'); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-200 transition hover:bg-zinc-800"
                    >
                      <FileCode2 className="h-4 w-4 text-zinc-400" /> Markdown (.md)
                    </button>
                    <button
                      onClick={() => { setExportOpen(false); onDownload('json'); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-200 transition hover:bg-zinc-800"
                    >
                      <FileJson className="h-4 w-4 text-zinc-400" /> JSON (.json)
                    </button>
                    <button
                      onClick={() => { setExportOpen(false); onDownload('pdf'); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-200 transition hover:bg-zinc-800"
                    >
                      <FileType className="h-4 w-4 text-zinc-400" /> PDF (.pdf)
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
          <button
            onClick={onSaveToStorage}
            disabled={!canSaveToStorage}
            title={canSaveToStorage ? 'Save to your archive' : 'Sign in to save'}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Archive className="h-3.5 w-3.5" /> Save to Storage
          </button>
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-zinc-200"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
