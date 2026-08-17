import type {
  JobContact,
  JobOutreach,
  UpdateJobOutreachInput,
} from "@shared/types";
import { Check, Copy, Save, Send } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import * as api from "@/client/api";
import { showErrorToast } from "@/client/lib/error-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface OutreachDraftEditorProps {
  jobId: string;
  contact: JobContact;
  outreach: JobOutreach;
  onUpdated(): void | Promise<void>;
}

function followUpLabel(value: number | null): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value * 1_000));
}

export function OutreachDraftEditor({
  jobId,
  contact,
  outreach,
  onUpdated,
}: OutreachDraftEditorProps) {
  const [subject, setSubject] = React.useState(outreach.subject);
  const [body, setBody] = React.useState(outreach.body);
  const [activeAction, setActiveAction] = React.useState<string | null>(null);

  React.useEffect(() => {
    setSubject(outreach.subject);
    setBody(outreach.body);
  }, [outreach.body, outreach.subject]);

  const persist = async (
    action: string,
    update: UpdateJobOutreachInput,
    successMessage: string,
  ) => {
    setActiveAction(action);
    try {
      await api.updateJobOutreach(jobId, outreach.id, update);
      await onUpdated();
      toast.success(successMessage);
    } catch (error) {
      showErrorToast(error, "Failed to update outreach");
    } finally {
      setActiveAction(null);
    }
  };

  const copyDraft = async () => {
    const text = subject ? `${subject}\n\n${body}` : body;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Draft copied");
    } catch (error) {
      showErrorToast(error, "Could not copy draft");
    }
  };

  const followUp = followUpLabel(outreach.followUpAt);

  return (
    <section className="rounded-lg border border-border/50 bg-background/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{outreach.channel}</Badge>
          <Badge
            variant={outreach.status === "draft" ? "secondary" : "outline"}
          >
            {outreach.status}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {outreach.purpose.replaceAll("_", " ")}
          </span>
        </div>
        {followUp && outreach.status === "sent" && (
          <span className="text-xs text-muted-foreground">
            Follow up {followUp}
          </span>
        )}
      </div>

      {outreach.channel === "email" && (
        <div className="mt-3 space-y-1.5">
          <Label htmlFor={`outreach-subject-${outreach.id}`}>Subject</Label>
          <Input
            id={`outreach-subject-${outreach.id}`}
            value={subject}
            maxLength={120}
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        <Label htmlFor={`outreach-body-${outreach.id}`}>
          Message to {contact.name}
        </Label>
        <Textarea
          id={`outreach-body-${outreach.id}`}
          value={body}
          maxLength={1_200}
          rows={6}
          onChange={(event) => setBody(event.target.value)}
        />
        <p className="text-right text-[11px] text-muted-foreground">
          {body.trim().split(/\s+/).filter(Boolean).length} words
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!body.trim() || activeAction !== null}
          onClick={() =>
            void persist(
              "save",
              { subject: subject.trim(), body: body.trim() },
              "Draft saved",
            )
          }
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {activeAction === "save" ? "Saving" : "Save"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void copyDraft()}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copy
        </Button>
        {outreach.status === "draft" && (
          <Button
            size="sm"
            disabled={!body.trim() || activeAction !== null}
            onClick={() =>
              void persist(
                "sent",
                { subject: subject.trim(), body: body.trim(), status: "sent" },
                "Marked sent; follow-up scheduled for 3 business days",
              )
            }
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {activeAction === "sent" ? "Updating" : "Mark sent"}
          </Button>
        )}
        {outreach.status === "sent" && (
          <Button
            size="sm"
            disabled={activeAction !== null}
            onClick={() =>
              void persist("replied", { status: "replied" }, "Reply recorded")
            }
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            {activeAction === "replied" ? "Updating" : "Mark replied"}
          </Button>
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        JobOps never sends this message. Copy it, send it yourself, then mark
        its status here.
      </p>
    </section>
  );
}
