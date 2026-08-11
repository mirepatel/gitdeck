# 🌿 Gitdeck

### Design × Development

.˚⊹₊⟡⋆

A modern SaaS dashboard for actionable repository intelligence. Built to instantly decode public GitHub repositories by visualizing codebase health, commit velocity, and contributor networks through an ultra-sleek, glassmorphic interface.

🟢 **[Live Demo](https://gitdeck.bolt.host/)**

---

## ✦ About

GitDeck is a production-minded frontend application designed to transform raw GitHub data into clear, actionable engineering metrics. Moving away from standard text-heavy logs, it serves as an analytical command center that visualizes the true health and momentum of any public codebase.

The architecture prioritizes a frictionless Product-Led Growth (PLG) experience, allowing instant unauthenticated searches with automated API rate limit fallbacks. The UI emphasizes visual restraint, butter-smooth micro-interactions, and premium Vercel-tier design aesthetics.

₊⊹

---

## ✦ Features

🌱 **Real-Time API Integration** • High-performance search queries connecting seamlessly with the GitHub API to fetch live repository vitals, issues, and commit histories.  
🌱 **Dynamic Data Visualization** • Interactive, fluid charts and metric cards engineered to display complex contributor networks and PR distributions at a glance.  
🌱 **Smart Rate Limiting** • Built-in environment fallbacks and user-provided Personal Access Token (PAT) configurations to effortlessly bypass standard public API limits.  
🌱 **Multi-Format Exporting** • Comprehensive auditing tool allowing users to download repository health reports in Markdown (.md), JSON (.json), or PDF formats.  
🌱 **Glassmorphic UI & Theming** • Premium layout featuring ambient radial gradients, custom scrollbars, and tactile hover states styled exclusively with Tailwind CSS.  

₊⊹

---

## ✦ Tech

![React](https://img.shields.io/badge/React-0f172a?style=flat&logo=react&logoColor=white&labelColor=0f172a) •
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-0f172a?style=flat&logo=tailwindcss&logoColor=white&labelColor=0f172a) •
![Framer Motion](https://img.shields.io/badge/Framer_Motion-0f172a?style=flat&logo=framer&logoColor=white&labelColor=0f172a) •
![Supabase](https://img.shields.io/badge/Supabase-0f172a?style=flat&logo=supabase&logoColor=white&labelColor=0f172a) •
![GitHub API](https://img.shields.io/badge/GitHub_API-0f172a?style=flat&logo=github&logoColor=white&labelColor=0f172a)

₊⊹

---

## ✦ Architecture

```text
gitdeck/
├── package.json
├── package-lock.json
├── README.md
├── index.html                # Main entry point with custom SVG favicon
├── vite.config.ts            # Vite build configuration
├── tailwind.config.js        # Tailwind theme and content paths
├── src/
│   ├── main.tsx              # Root initialization and React DOM mount
│   ├── index.css             # Global layout tokens & custom scrollbar
│   ├── App.tsx               # Core routing, state, and component canvas
│   ├── types.ts              # Shared TypeScript interfaces
│   ├── analytics.ts          # Health scoring, commit timeline, bus factor
│   ├── github.ts             # GitHub API fetch and PAT fallback logic
│   └── lib/
│       ├── auth.tsx          # Supabase email/password auth context
│       ├── supabase.ts       # Supabase client initialization
│       └── storage.ts        # Audit report archive (Supabase Storage)
└── supabase/
    ├── migrations/           # Database schema and RLS policies
    └── functions/            # Edge functions (GitHub proxy, audit storage)
```

₊⊹

---

## ✦ Connect

[LinkedIn](https://www.linkedin.com/in/mirepatel) • [Portfolio](https://mirepatel.framer.website/) • [Email](mailto:mirepatel@gmail.com)

---

**C**ode

**C**reativity

**C**ontinuous Learning

•··
