"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  LogOut,
  ChevronRight,
  Building2,
  FileText,
  Eye,
  Layers,
  MessageSquareText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import {
  usePreferencesStore,
  type OutputStyle,
  type Department,
} from "@/stores/preferences";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { InstitutionToggle } from "@/components/chat/institution-toggle";
import { ModelSelector } from "@/components/chat/model-selector";

const OUTPUT_STYLES: { value: OutputStyle; label: string; description: string }[] = [
  { value: "concise", label: "Concise", description: "Direct answers, minimal elaboration" },
  { value: "detailed", label: "Detailed", description: "Thorough coverage with full reasoning" },
  { value: "auto", label: "Auto", description: "Adapts length to question complexity" },
];

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: "ABDOMINAL", label: "Abdominal" },
  { value: "NEURO", label: "Neuroradiology" },
  { value: "MSK", label: "Musculoskeletal" },
  { value: "CHEST", label: "Chest" },
  { value: "IR", label: "Interventional" },
  { value: "PEDS", label: "Pediatric" },
  { value: "BREAST", label: "Breast Imaging" },
  { value: "NUCLEAR", label: "Nuclear Medicine" },
  { value: "CARDIAC", label: "Cardiac" },
  { value: "EMERGENCY", label: "Emergency" },
  { value: "GENERAL", label: "General" },
];

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsPanel({ isOpen, onClose }: SettingsPanelProps) {
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const {
    outputStyle,
    showConfidenceScores,
    autoExpandSources,
    department,
    selectedInstitution,
    crossChatMemoryEnabled,
    setOutputStyle,
    setShowConfidenceScores,
    setAutoExpandSources,
    setDepartment,
    setSelectedInstitution,
    setCrossChatMemoryEnabled,
  } = usePreferencesStore();

  const [activeSection, setActiveSection] = useState<"main" | "output" | "department">("main");

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Panel - Fixed position, scrollable when content overflows */}
      <div className="fixed bottom-16 left-4 w-72 max-h-[calc(100vh-5rem)] bg-white/85 dark:bg-slate-900/85 backdrop-blur-2xl rounded-[24px] shadow-[0_8px_30px_-6px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.4)] border border-slate-200/50 dark:border-slate-700/50 overflow-y-auto overscroll-contain z-50">
        {activeSection === "main" ? (
          <>
            {/* Institution toggle */}
            <div className="p-2.5 border-b border-slate-100/50 dark:border-slate-700/30">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 px-1 uppercase tracking-wider">
                Policy Source
              </p>
              <InstitutionToggle
                selected={selectedInstitution}
                onChange={setSelectedInstitution}
              />
            </div>

            {/* Model selector */}
            <div className="p-2.5 border-b border-slate-100/50 dark:border-slate-700/30">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5 px-1 uppercase tracking-wider">AI Model</p>
              <ModelSelector />
            </div>

            {/* User info header & Theme */}
            <div className="p-3 border-b border-slate-100/50 dark:border-slate-700/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/50 flex items-center justify-center">
                  <User className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">
                    {user?.name || "User"}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {user?.email || ""}
                  </p>
                </div>
              </div>
              <ThemeToggle />
            </div>

            {/* Settings options */}
            <div className="p-2">
              <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                {/* Output style */}
                <button
                  onClick={() => setActiveSection("output")}
                  className="flex flex-col items-start px-3 py-2 rounded-2xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-700/50 border border-slate-200/50 dark:border-slate-700/50 transition-colors"
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <ChevronRight className="w-3 h-3 text-slate-300" />
                  </div>
                  <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">Style</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 capitalize truncate w-full text-left">{outputStyle}</p>
                </button>

                {/* Department */}
                <button
                  onClick={() => setActiveSection("department")}
                  className="flex flex-col items-start px-3 py-2 rounded-2xl bg-slate-50/50 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-700/50 border border-slate-200/50 dark:border-slate-700/50 transition-colors"
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <ChevronRight className="w-3 h-3 text-slate-300" />
                  </div>
                  <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">Dept</p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate w-full text-left">
                    {department ? DEPARTMENTS.find(d => d.value === department)?.label : "Not set"}
                  </p>
                </button>
              </div>

              {/* Toggles */}
              <div className="border-t border-slate-100/50 dark:border-slate-700/30 pt-1">
                <label className="flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors">
                  <div className="flex items-center gap-2.5">
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[12px] text-slate-700 dark:text-slate-300">Show confidence</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={showConfidenceScores}
                    onChange={(e) => setShowConfidenceScores(e.target.checked)}
                    className="w-3.5 h-3.5 rounded-[4px] border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                </label>

                <label className="flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors">
                  <div className="flex items-center gap-2.5">
                    <MessageSquareText className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[12px] text-slate-700 dark:text-slate-300">Cross-chat memory</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={crossChatMemoryEnabled}
                    onChange={(e) => setCrossChatMemoryEnabled(e.target.checked)}
                    className="w-3.5 h-3.5 rounded-[4px] border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                </label>

                <label className="flex items-center justify-between px-2 py-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer transition-colors">
                  <div className="flex items-center gap-2.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[12px] text-slate-700 dark:text-slate-300">Auto-expand sources</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoExpandSources}
                    onChange={(e) => setAutoExpandSources(e.target.checked)}
                    className="w-3.5 h-3.5 rounded-[4px] border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                </label>
              </div>
            </div>

            {/* Logout */}
            <div className="p-1.5 border-t border-slate-100/50 dark:border-slate-700/30">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-full text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-[13px] font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                Log out
              </button>
            </div>
          </>
        ) : activeSection === "output" ? (
          <>
            {/* Output style selection */}
            <div className="p-2 border-b border-slate-100/50 dark:border-slate-700/30 flex items-center gap-2">
              <button
                onClick={() => setActiveSection("main")}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-500 rotate-180" />
              </button>
              <span className="text-[13px] font-medium text-slate-900 dark:text-slate-100">Output Style</span>
            </div>
            <div className="p-1.5">
              {OUTPUT_STYLES.map((style) => (
                <button
                  key={style.value}
                  onClick={() => {
                    setOutputStyle(style.value);
                    setActiveSection("main");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-2xl transition-colors",
                    outputStyle === style.value
                      ? "bg-brand-50 dark:bg-brand-900/30"
                      : "hover:bg-slate-50 dark:hover:bg-slate-700/30"
                  )}
                >
                  <p className={cn(
                    "text-[13px] font-medium",
                    outputStyle === style.value
                      ? "text-brand-700 dark:text-brand-300"
                      : "text-slate-700 dark:text-slate-300"
                  )}>
                    {style.label}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{style.description}</p>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Department selection */}
            <div className="p-2 border-b border-slate-100/50 dark:border-slate-700/30 flex items-center gap-2">
              <button
                onClick={() => setActiveSection("main")}
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
              >
                <ChevronRight className="w-4 h-4 text-slate-500 rotate-180" />
              </button>
              <span className="text-[13px] font-medium text-slate-900 dark:text-slate-100">Department</span>
            </div>
            <div className="p-1.5 max-h-64 overflow-y-auto">
              <button
                onClick={() => {
                  setDepartment(null);
                  setActiveSection("main");
                }}
                className={cn(
                  "w-full text-left px-3 py-1.5 rounded-2xl transition-colors text-[13px]",
                  department === null
                    ? "bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-medium"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                )}
              >
                All Departments
              </button>
              {DEPARTMENTS.map((dept) => (
                <button
                  key={dept.value}
                  onClick={() => {
                    setDepartment(dept.value);
                    setActiveSection("main");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-2xl transition-colors text-[13px]",
                    department === dept.value
                      ? "bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 font-medium"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/30"
                  )}
                >
                  {dept.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
