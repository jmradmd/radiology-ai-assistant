"use client";

import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Search,
  Phone,
  Mail,
  ExternalLink,
  AlertTriangle,
  Building2,
  Stethoscope,
  Sparkles,
  Monitor,
  Users,
  LayoutGrid,
  Network,
  MonitorSmartphone,
  Bot,
  X,
  Globe,
  Clock,
  MapPin,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DIRECTORY_SECTIONS,
  type DirectorySection,
  type DirectoryContact,
  type DirectorySystem,
} from "@rad-assist/shared";
import { useRouter } from "next/navigation";

// Map icon name strings from data to Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  AlertTriangle,
  Monitor,
  Building2,
  Stethoscope,
  Users,
  MonitorSmartphone,
  Sparkles,
  LayoutGrid,
  Network,
};

function SectionIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] || HelpCircle;
  return <Icon className={className} />;
}

function matchesSearch(query: string, ...fields: (string | undefined | null)[]): boolean {
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export default function ReferencePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "contacts" | "systems">("all");

  const filteredSections = useMemo(() => {
    return DIRECTORY_SECTIONS
      .filter((section) => {
        if (activeTab === "contacts" && section.type !== "contacts") return false;
        if (activeTab === "systems" && section.type !== "systems") return false;
        return true;
      })
      .map((section) => {
        if (!searchQuery.trim()) return section;

        if (section.type === "contacts" && section.contacts) {
          const filtered = section.contacts.filter((c) =>
            matchesSearch(searchQuery, c.name, c.phone, c.email, c.notes, c.location)
          );
          if (filtered.length === 0) return null;
          return { ...section, contacts: filtered };
        }
        if (section.type === "systems" && section.systems) {
          const filtered = section.systems.filter((s) =>
            matchesSearch(searchQuery, s.name, s.purpose, s.notes, s.supportContact, s.accessUrl)
          );
          if (filtered.length === 0) return null;
          return { ...section, systems: filtered };
        }
        return section;
      })
      .filter(Boolean) as DirectorySection[];
  }, [searchQuery, activeTab]);

  const totalResults = filteredSections.reduce((sum, s) => {
    return sum + (s.contacts?.length ?? 0) + (s.systems?.length ?? 0);
  }, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)]">
      {/* Header */}
      <header className="flex-shrink-0 header-blur border-b border-slate-200/80 dark:border-slate-800/80 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">Directory</h1>
          <button
            onClick={() => router.push("/chat")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/30 rounded-full hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            Ask the assistant
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts, systems, phone numbers..."
            className="pl-9 pr-8 h-9 text-sm bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <X className="w-3.5 h-3.5 text-slate-400" />
            </button>
          )}
        </div>

        {/* Tab Filter */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
          <TabsList className="w-full h-8">
            <TabsTrigger value="all" className="flex-1 text-xs">All</TabsTrigger>
            <TabsTrigger value="contacts" className="flex-1 text-xs">Contacts</TabsTrigger>
            <TabsTrigger value="systems" className="flex-1 text-xs">Systems</TabsTrigger>
          </TabsList>
        </Tabs>
      </header>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {searchQuery && (
            <p className="text-xs text-muted-foreground">
              {totalResults} result{totalResults !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
            </p>
          )}

          {filteredSections.length === 0 ? (
            <div className="text-center py-12">
              <Search className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground mt-1">Try a different search term</p>
            </div>
          ) : (
            filteredSections.map((section) => (
              <div key={section.id}>
                {/* Section Header */}
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn(
                    "h-7 w-7 rounded-lg flex items-center justify-center",
                    section.id === "EMERGENCY"
                      ? "bg-emergency-100 dark:bg-emergency-700/20"
                      : "bg-slate-100 dark:bg-slate-800"
                  )}>
                    <SectionIcon
                      name={section.icon}
                      className={cn(
                        "w-3.5 h-3.5",
                        section.id === "EMERGENCY"
                          ? "text-emergency-600 dark:text-emergency-400"
                          : "text-slate-500 dark:text-slate-400"
                      )}
                    />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold tracking-tight">{section.label}</h2>
                    <p className="text-[11px] text-muted-foreground">{section.description}</p>
                  </div>
                </div>

                {/* Contact Cards */}
                {section.type === "contacts" && section.contacts && (
                  <Card className="border-slate-200/80 dark:border-slate-700/60 overflow-hidden">
                    <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
                      {section.contacts.map((contact, i) => (
                        <ContactRow key={`${section.id}-c-${i}`} contact={contact} isEmergency={section.id === "EMERGENCY"} />
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* System Cards */}
                {section.type === "systems" && section.systems && (
                  <Card className="border-slate-200/80 dark:border-slate-700/60 overflow-hidden">
                    <CardContent className="p-0 divide-y divide-slate-100 dark:divide-slate-800">
                      {section.systems.map((system, i) => (
                        <SystemRow key={`${section.id}-s-${i}`} system={system} />
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            ))
          )}

          {/* Footer */}
          <p className="text-[11px] text-center text-muted-foreground pb-2 pt-4">
            Items marked [UNVERIFIED] need internal confirmation.
            <br />
            To update, edit <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1 rounded">directory-data.ts</code> and re-ingest.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}

// ================================================================
// SUB-COMPONENTS
// ================================================================

function ContactRow({ contact, isEmergency }: { contact: DirectoryContact; isEmergency: boolean }) {
  return (
    <div className={cn(
      "p-3 space-y-1",
      isEmergency && contact.priority === "critical" && "bg-emergency-50/50 dark:bg-emergency-700/10"
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={cn(
              "text-sm font-medium",
              isEmergency && "text-emergency-700 dark:text-emergency-300"
            )}>
              {contact.name}
            </p>
            {contact.institution && (
              <InstitutionBadge institution={contact.institution} />
            )}
          </div>
          {contact.notes && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{contact.notes}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {contact.phone && (
          <a
            href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}
            className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            <Phone className="w-3 h-3" />
            {contact.phone}
          </a>
        )}
        {contact.phoneAlt && (
          <span className="text-[11px] text-muted-foreground">({contact.phoneAlt})</span>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            <Mail className="w-3 h-3" />
            {contact.email}
          </a>
        )}
        {contact.url && (
          <a
            href={contact.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
          >
            <Globe className="w-3 h-3" />
            Portal
          </a>
        )}
        {contact.hours && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="w-2.5 h-2.5" />
            {contact.hours}
          </span>
        )}
        {contact.location && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <MapPin className="w-2.5 h-2.5" />
            {contact.location}
          </span>
        )}
      </div>
    </div>
  );
}

function SystemRow({ system }: { system: DirectorySystem }) {
  return (
    <div className="p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium">{system.name}</p>
            {system.institution && (
              <InstitutionBadge institution={system.institution} />
            )}
          </div>
          <p className="text-xs text-muted-foreground">{system.purpose}</p>
        </div>
      </div>

      {(system.notes || system.accessUrl || system.supportContact) && (
        <div className="flex items-center gap-3 flex-wrap">
          {system.accessUrl && system.accessUrl.startsWith("http") && (
            <a
              href={system.accessUrl}
              className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="w-3 h-3" />
              {system.accessUrl.length > 35 ? "Access Link" : system.accessUrl}
            </a>
          )}
          {system.accessUrl && !system.accessUrl.startsWith("http") && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ExternalLink className="w-2.5 h-2.5" />
              {system.accessUrl}
            </span>
          )}
          {system.supportContact && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Phone className="w-2.5 h-2.5" />
              {system.supportContact}
            </span>
          )}
          {system.notes && (
            <p className="text-[11px] text-muted-foreground w-full">{system.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

function InstitutionBadge({ institution }: { institution: string }) {
  // Matches INSTITUTION_CONFIG badge variants:
  // Institution A -> "default" (teal/primary), INSTITUTION_B -> "destructive" (red), SHARED -> "secondary"
  const variant = institution === "INSTITUTION_A" ? "default" : institution === "INSTITUTION_B" ? "destructive" : "secondary";
  const label = institution === "BOTH" ? "Institution A / Institution B" : institution;
  return (
    <Badge variant={variant} className="text-[9px] px-1.5 py-0 h-4 flex-shrink-0">
      {label}
    </Badge>
  );
}
