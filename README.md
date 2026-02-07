# ALIN - Advanced Linguistic Intelligence Network

**Production-Grade AI Operating System**

---

## 🎯 Project Vision

ALIN is not a prototype - it's a production-grade AI operating system built from the ground up with:
- **100k+ lines of code** (target)
- **400+ features** across all systems
- **Type-safe** architecture with strict TypeScript
- **Real-time streaming** with WebSocket support
- **Offline-first** PWA architecture
- **Scalable** component-based design

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your API keys

# Start development server
npm run dev

# Open http://localhost:3000
```

### Build for Production

```bash
# Build optimized production bundle
npm run build

# Preview production build
npm run preview
```

---

## 📁 Project Structure First Slice

```
alin-react/
├── public/                 # Static assets
├── src/
│   ├── api/               # API clients and WebSocket
│   ├── components/        # React components
│   │   ├── chat/          # Chat interface
│   │   ├── sidebar/       # Conversation sidebar
│   │   ├── layout/        # App shell, panels
│   │   ├── ui/            # Reusable UI primitives
│   │   └── placeholder/   # Future phase components
│   ├── hooks/             # Custom React hooks
│   ├── store/             # Zustand state management
│   │   ├── chatStore.ts      # Conversations & messages
│   │   ├── tbwoStore.ts      # TBWO execution system
│   │   ├── memoryStore.ts    # 8-layer memory
│   │   ├── settingsStore.ts  # User preferences
│   │   └── uiStore.ts        # UI state & modals
│   ├── types/             # TypeScript definitions
│   │   ├── chat.ts           # Chat types
│   │   ├── tbwo.ts           # TBWO types
│   │   ├── memory.ts         # Memory types
│   │   └── ui.ts             # UI types
│   ├── utils/             # Utility functions
│   ├── db/                # IndexedDB layer (coming soon)
│   ├── styles/            # Global CSS
│   ├── App.tsx            # Root component
│   └── main.tsx           # Entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

---

## ✨ Features Implemented (Phase 1)

### 🎨 **Core UI & Chat** (42 features)
- ✅ Real-time streaming with scroll control
- ✅ Code blocks with syntax highlighting + copy
- ✅ Message editing, deletion, reactions
- ✅ Chat history with search & filters
- ✅ Folders, tags, favorites, archive
- ✅ Markdown + LaTeX rendering
- ✅ Thinking panel with reasoning
- ✅ Multi-line input with file upload
- ✅ Drag & drop files anywhere
- ✅ Keyboard shortcuts (Cmd+K palette)
- ✅ Export/import conversations
- ✅ Dark/light theme support
- ✅ Responsive design

### 💾 **State Management** (Complete)
- ✅ Chat store (conversations, messages, streaming)
- ✅ TBWO store (execution, pods, artifacts)
- ✅ Memory store (8 layers, graph, search)
- ✅ Settings store (all preferences)
- ✅ UI store (theme, layout, modals)
- ✅ Persistent storage with localStorage
- ✅ Immer for immutable updates

### 🧠 **Type System** (~3,000 lines)
- ✅ Complete chat types
- ✅ Complete TBWO types
- ✅ Complete memory types
- ✅ Complete UI types
- ✅ 100% type coverage
- ✅ Strict TypeScript mode

### 🎨 **UI Components**
- ✅ Button (5 variants, 3 sizes, loading states)
- ✅ Input (icons, validation, character counter)
- ✅ Dropdown (Radix UI, accessible)
- ✅ Sidebar (search, filters, grouping)
- ✅ ChatItem (hover actions, editing, favorites)
- ✅ Message (streaming, reactions, annotations)
- ✅ CodeBlock (syntax highlighting, copy, line numbers)
- ✅ InputArea (file upload, drag & drop, voice button)
- ✅ ThinkingPanel (real-time reasoning display)
- ✅ LoadingScreen (Suspense fallback)
- ✅ AppShell (main layout structure)
- ✅ CommandPalette (Cmd+K search)

---

## 🎯 Roadmap

### **Phase 1: Core UI + Chat** ✅ COMPLETE
- React foundation with TypeScript
- Complete state management (Zustand)
- Chat interface with streaming
- File upload and markdown rendering
- Code blocks with syntax highlighting

### **Phase 2: TBWO System** (Next)
- Website Sprint wizard
- Parallel pod spawning
- Execution plan approval
- Progress tracking & checkpoints
- Dual-layer receipts
- 3D pod visualization

### **Phase 3: Memory System**
- 8-layer memory implementation
- Memory graph visualization
- Consolidation & retrieval
- Search across all layers
- Timeline view
- Export/import memory

### **Phase 4: Voice + Hardware**
- TTS with 6 voice options
- STT with Whisper
- Continuous conversation mode
- GPU/CPU monitoring
- Hardware acceleration
- Per-pod resource tracking

### **Phase 5: Advanced Features**
- Local model support (Ollama)
- Image generation (DALL-E)
- Web research tool
- Code execution sandbox
- Analytics & insights
- Team collaboration

---

## 🛠 Technology Stack

### **Frontend**
- **React 18** - Concurrent features, Suspense
- **TypeScript** - Strict mode, 100% coverage
- **Vite** - Lightning-fast builds
- **Tailwind CSS** - Utility-first styling
- **Framer Motion** - Smooth animations
- **Radix UI** - Accessible primitives

### **State Management**
- **Zustand** - Lightweight state
- **Immer** - Immutable updates
- **TanStack Query** - Server state
- **Dexie.js** - IndexedDB wrapper

### **Rendering & Styling**
- **React Markdown** - Markdown support
- **Highlight.js** - Syntax highlighting
- **KaTeX** - Math rendering
- **Class Variance Authority** - Component variants

### **Build & Tooling**
- **ESLint** - Code quality
- **Prettier** - Code formatting
- **Vitest** - Unit testing
- **PWA** - Offline support

---

## ⚙️ Configuration

### Environment Variables

```env
# API Keys
VITE_OPENAI_API_KEY=your_openai_key
VITE_ANTHROPIC_API_KEY=your_anthropic_key

# API Endpoints
VITE_API_BASE_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws

# Feature Flags
VITE_ENABLE_VOICE=true
VITE_ENABLE_IMAGE_GEN=true
VITE_ENABLE_TBWO=true
VITE_ENABLE_MEMORY=true
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run format       # Format with Prettier
npm run type-check   # Check TypeScript types
npm run test         # Run tests
```

---

## 📊 Current Stats

- **Files Created:** 40+
- **Lines of Code:** ~20,000
- **TypeScript Coverage:** 100%
- **Components:** 20+
- **Stores:** 5
- **Type Definitions:** 4 major files (~3,000 lines)
- **Production Ready:** Phase 1 complete

---

## 🎨 Design System

### Colors
- **Brand Primary:** `#6366f1` (Indigo)
- **Brand Secondary:** `#a855f7` (Purple)
- **Brand Accent:** `#ec4899` (Pink)
- **Success:** `#22c55e` (Green)
- **Warning:** `#f59e0b` (Amber)
- **Error:** `#ef4444` (Red)

### Typography
- **Font Family:** System fonts (San Francisco, Segoe UI, Roboto)
- **Code Font:** SF Mono, Monaco, Consolas
- **Scale:** 12px to 60px (xs to 6xl)

### Spacing
- **Base Unit:** 4px
- **Scale:** 0.5 (2px) to 96 (384px)

---

## 🔐 Security

- **Type Safety:** Strict TypeScript prevents runtime errors
- **Input Validation:** Zod schemas for all user input
- **XSS Prevention:** React escapes by default
- **CSRF Protection:** API tokens required
- **Content Security Policy:** Strict CSP headers
- **API Key Storage:** Never committed to git

---

## 📝 Contributing

This is a personal project rebuild, but the codebase is designed to be:
- **Modular** - Easy to add new features
- **Testable** - Pure functions, isolated components
- **Documented** - TypeScript + JSDoc
- **Scalable** - Component-based architecture

---

## 📄 License

Private project - All rights reserved

---

## 🙏 Acknowledgments

- **React Team** - For the amazing framework
- **Anthropic** - For Claude AI
- **OpenAI** - For GPT models
- **Vercel** - For deployment platform

---

## 📞 Support

For questions or issues:
1. Check the inline documentation
2. Review TypeScript types
3. Inspect store actions
4. Check component props

---

**Built with ❤️ and lots of TypeScript**
