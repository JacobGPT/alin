#!/usr/bin/env python3
"""
ALIN Capabilities Display Script
A decorated Python script showcasing ALIN's abilities
"""

def display_capabilities():
    print("=" * 60)
    print("🤖 ALIN - Artificial Life Intelligence Network")
    print("   Your Advanced AI Assistant with Real Tools")
    print("=" * 60)

    capabilities = {
        "🔍 WEB SEARCH & RESEARCH": [
            "Real-time internet search",
            "Current events & news lookup", 
            "Multi-source research",
            "Dynamic data retrieval"
        ],
        
        "🧠 PERSISTENT MEMORY": [
            "8-layer memory architecture",
            "Cross-session conversation memory",
            "User preference storage",
            "Context consolidation"
        ],
        
        "💻 CODE EXECUTION": [
            "Python, JavaScript, TypeScript",
            "Sandboxed safe environment",
            "Real-time testing & debugging", 
            "Data processing & visualization"
        ],
        
        "📁 FILE OPERATIONS": [
            "Read/write user files",
            "Directory navigation",
            "Project analysis",
            "Secure file management"
        ],
        
        "🔄 WORKFLOW ORCHESTRATION": [
            "Multi-step task coordination",
            "Parallel processing",
            "Dependency management",
            "Error handling & recovery"
        ],
        
        "⚙️ SYSTEM MONITORING": [
            "Hardware status tracking",
            "Performance metrics",
            "Resource utilization",
            "Health diagnostics"
        ]
    }

    print("\n🌟 MY CORE CAPABILITIES:")
    print("-" * 40)

    for category, features in capabilities.items():
        print(f"\n{category}")
        print("-" * len(category))
        for feature in features:
            print(f"  • {feature}")

    print("\n" + "-" * 40)
    print("\n🚀 WHAT MAKES ME SPECIAL:")
    print("  ✓ Real functional tools, not just chat")
    print("  ✓ Internet browsing & current info")
    print("  ✓ Persistent memory across sessions")
    print("  ✓ Code execution & file access")
    print("  ✓ Complex problem-solving workflows")

    print("\n💡 READY TO HELP WITH:")
    print("  Research • Coding • Data Analysis")
    print("  File Management • System Tasks")
    print("  Complex Multi-Step Projects")

    print("\n" + "=" * 60)
    print("🎯 ALIN - Your AI Operating System")
    print("=" * 60)

if __name__ == "__main__":
    display_capabilities()