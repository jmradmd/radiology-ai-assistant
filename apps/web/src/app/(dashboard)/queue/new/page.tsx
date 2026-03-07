"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, AlertCircle, Loader2 } from "lucide-react";
import {
  detectPotentialPHI,
  getUnresolvedBlockingSpans,
  SUBSPECIALTY_DISPLAY_NAMES,
  type PHIDetectionSpan,
  type PHIOverrideSelection,
} from "@rad-assist/shared";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { PhiHighlightedInput, PhiHighlightedTextarea } from "@/components/ui/phi-highlight-field";

const requestTypes = [
  { value: "PROTOCOL_QUESTION", label: "Protocol Question" },
  { value: "SPEAK_TO_RADIOLOGIST", label: "Speak to Radiologist" },
  { value: "SCHEDULE_INQUIRY", label: "Schedule Inquiry" },
  { value: "URGENT_STAT", label: "Urgent/STAT" },
  { value: "ADMINISTRATIVE", label: "Administrative" },
];

const priorities = [
  { value: "STAT", label: "STAT", color: "stat" },
  { value: "URGENT", label: "Urgent", color: "urgent" },
  { value: "ROUTINE", label: "Routine", color: "routine" },
];

export default function NewRequestPage() {
  const router = useRouter();
  const [subjectOverrides, setSubjectOverrides] = useState<Set<string>>(new Set());
  const [descriptionOverrides, setDescriptionOverrides] = useState<Set<string>>(new Set());

  const createRequest = trpc.request.create.useMutation({
    onSuccess: () => {
      router.push("/queue");
    },
  });

  const isSubmitting = createRequest.isPending;

  const [form, setForm] = useState({
    type: "",
    priority: "ROUTINE",
    subspecialty: "",
    subject: "",
    description: "",
    location: "",
  });

  const subjectPhiResult = useMemo(() => (form.subject ? detectPotentialPHI(form.subject) : null), [form.subject]);
  const descriptionPhiResult = useMemo(
    () => (form.description ? detectPotentialPHI(form.description) : null),
    [form.description]
  );

  const subjectOverridePayload: PHIOverrideSelection[] = (subjectPhiResult?.detectionSpans ?? [])
    .filter((span) => subjectOverrides.has(span.id))
    .map((span) => ({
      spanId: span.id,
      type: span.type,
      inputHash: subjectPhiResult?.inputHash ?? "",
      acknowledged: true as const,
    }));

  const descriptionOverridePayload: PHIOverrideSelection[] = (descriptionPhiResult?.detectionSpans ?? [])
    .filter((span) => descriptionOverrides.has(span.id))
    .map((span) => ({
      spanId: span.id,
      type: span.type,
      inputHash: descriptionPhiResult?.inputHash ?? "",
      acknowledged: true as const,
    }));

  const unresolvedSubjectSpans = subjectPhiResult
    ? getUnresolvedBlockingSpans(subjectPhiResult, subjectOverridePayload)
    : [];
  const unresolvedDescriptionSpans = descriptionPhiResult
    ? getUnresolvedBlockingSpans(descriptionPhiResult, descriptionOverridePayload)
    : [];

  const unresolvedCount = unresolvedSubjectSpans.length + unresolvedDescriptionSpans.length;
  const phiWarning = unresolvedCount > 0
    ? `Protected health information detected (${unresolvedCount} unresolved item${unresolvedCount > 1 ? "s" : ""})`
    : null;

  useEffect(() => {
    const currentIds = new Set(subjectPhiResult?.detectionSpans.map((span) => span.id) ?? []);
    setSubjectOverrides((prev) => {
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [subjectPhiResult?.inputHash]);

  useEffect(() => {
    const currentIds = new Set(descriptionPhiResult?.detectionSpans.map((span) => span.id) ?? []);
    setDescriptionOverrides((prev) => {
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [descriptionPhiResult?.inputHash]);

  const overrideSubjectSpan = (span: PHIDetectionSpan) => {
    setSubjectOverrides((prev) => {
      const next = new Set(prev);
      next.add(span.id);
      return next;
    });
  };

  const overrideDescriptionSpan = (span: PHIDetectionSpan) => {
    setDescriptionOverrides((prev) => {
      const next = new Set(prev);
      next.add(span.id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!form.type || !form.subject || phiWarning) return;
    await createRequest.mutateAsync({
      type: form.type as "PROTOCOL_QUESTION" | "SPEAK_TO_RADIOLOGIST" | "SCHEDULE_INQUIRY" | "URGENT_STAT" | "ADMINISTRATIVE",
      priority: form.priority as "STAT" | "URGENT" | "ROUTINE",
      subject: form.subject.trim(),
      description: form.description.trim() || undefined,
      // Keep compatibility with older request payload shape.
      content: form.description.trim() || form.subject.trim(),
      location: form.location.trim() || undefined,
      subspecialty: form.subspecialty
        ? (form.subspecialty as
            | "ABDOMINAL"
            | "NEURO"
            | "MSK"
            | "CHEST"
            | "IR"
            | "PEDS"
            | "BREAST"
            | "NUCLEAR"
            | "CARDIAC"
            | "EMERGENCY")
        : undefined,
      phiOverrides: {
        ...(subjectOverridePayload.length > 0 && { subject: subjectOverridePayload as { type: string; spanId: string; inputHash: string; acknowledged: true }[] }),
        ...(descriptionOverridePayload.length > 0 && { description: descriptionOverridePayload as { type: string; spanId: string; inputHash: string; acknowledged: true }[] }),
      },
    });
  };

  const isValid = form.type && form.subject && !phiWarning;

  return (
    <div className="flex flex-col h-[calc(100vh-5.5rem)]">
      {/* Header */}
      <header className="flex-shrink-0 header-blur">
        <div className="flex items-center gap-3 p-4">
          <Link href="/queue">
            <Button variant="ghost" size="icon" className="rounded-xl">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold tracking-tight">New Request</h1>
        </div>
      </header>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* PHI Warning */}
          {phiWarning && (
            <div className="flex items-center gap-2.5 text-amber-700 dark:text-amber-300 text-sm p-3.5 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800/50">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-500" />
              <span>
                {phiWarning}. Hover over red-underlined text and override each item if intentional.
              </span>
            </div>
          )}

          {/* Request Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Request Type *</label>
            <Select
              value={form.type}
              onValueChange={(value) => setForm((prev) => ({ ...prev, type: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {requestTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Priority *</label>
            <div className="flex gap-2">
              {priorities.map((priority) => (
                <Button
                  key={priority.value}
                  type="button"
                  variant={form.priority === priority.value ? priority.color as "stat" | "urgent" | "routine" : "outline"}
                  className="flex-1"
                  onClick={() => setForm((prev) => ({ ...prev, priority: priority.value }))}
                >
                  {priority.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Subspecialty */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Subspecialty</label>
            <Select
              value={form.subspecialty}
              onValueChange={(value) => setForm((prev) => ({ ...prev, subspecialty: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select subspecialty (optional)..." />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SUBSPECIALTY_DISPLAY_NAMES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Subject */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Subject *</label>
            <PhiHighlightedInput
              value={form.subject}
              onChange={(value) => setForm((prev) => ({ ...prev, subject: value }))}
              placeholder="Brief description of your request..."
              maxLength={200}
              spans={subjectPhiResult?.detectionSpans ?? []}
              overriddenSpanIds={subjectOverrides}
              onOverrideSpan={overrideSubjectSpan}
            />
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {form.subject.length}/200
            </p>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Details</label>
            <PhiHighlightedTextarea
              value={form.description}
              onChange={(value) => setForm((prev) => ({ ...prev, description: value }))}
              placeholder="Additional details (do not include patient identifiers)..."
              rows={4}
              maxLength={2000}
              spans={descriptionPhiResult?.detectionSpans ?? []}
              overriddenSpanIds={descriptionOverrides}
              onOverrideSpan={overrideDescriptionSpan}
              textareaClassName="min-h-[96px] px-3 py-2"
              overlayClassName="px-3 py-2"
            />
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {form.description.length}/2000
            </p>
          </div>

          {/* Location */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Location</label>
            <Input
              value={form.location}
              onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="e.g., CT Suite A, ED Bay 4, Floor 7..."
              maxLength={100}
            />
          </div>
        </div>
      </ScrollArea>

      {/* Submit Button */}
      <div className="flex-shrink-0 border-t border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4">
        <Button
          onClick={handleSubmit}
          disabled={!isValid || isSubmitting}
          className="w-full h-12 shadow-sm shadow-primary/20"
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting...
            </>
          ) : createRequest.error ? (
            createRequest.error.message
          ) : (
            "Submit Request"
          )}
        </Button>
      </div>
    </div>
  );
}
