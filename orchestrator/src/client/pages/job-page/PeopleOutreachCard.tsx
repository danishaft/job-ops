import type {
  CreateJobContactInput,
  Job,
  JobContact,
  JobContactRole,
} from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import {
  ExternalLink,
  MailPlus,
  Plus,
  Search,
  Star,
  Trash2,
  UserRoundSearch,
} from "lucide-react";
import React from "react";
import { toast } from "sonner";
import * as api from "@/client/api";
import { showErrorToast } from "@/client/lib/error-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OutreachDraftEditor } from "./OutreachDraftEditor";

interface PeopleOutreachCardProps {
  job: Job;
}

const roleLabels: Record<JobContactRole, string> = {
  warm_referrer: "Warm referrer",
  decision_maker: "Decision maker",
  founder: "Founder",
  engineering_leader: "Engineering leader",
  team_member: "Team member",
  recruiter: "Recruiter",
};

const routeGuidance: Record<Job["opportunityRoute"], string> = {
  referral_first:
    "Find the warm connection first, ask for context or a referral, then apply through the recommended path.",
  direct_email_application:
    "Use the published application address for the application and track a relevant hiring contact separately.",
  apply_then_contact:
    "Apply first, then contact the person closest to the work with a specific, relevant proof point.",
  contribute_then_connect:
    "Make a useful public contribution first, then contact the maintainer or engineering owner with that evidence.",
  speculative_outreach:
    "There is no open role. Contact a founder or engineering leader only when a real hiring signal and relevant proof exist.",
  submit_talent_profile:
    "Submit the talent-network profile, then track a portfolio talent partner or company contact when one is publicly supported.",
  watch:
    "Keep the company on watch. Research people only when a stronger hiring or relationship signal appears.",
  archive_ineligible:
    "Do not spend outreach effort unless the eligibility decision changes.",
};

type ContactFormState = {
  name: string;
  title: string;
  company: string;
  role: JobContactRole;
  sourceUrl: string;
  evidenceSummary: string;
  relevanceReason: string;
  linkedinUrl: string;
  email: string;
};

function initialContact(job: Job): ContactFormState {
  return {
    name: "",
    title: "",
    company: job.employer,
    role: "engineering_leader",
    sourceUrl: "",
    evidenceSummary: "",
    relevanceReason: "",
    linkedinUrl: "",
    email: "",
  };
}

function contactProfileUrl(contact: JobContact): string {
  return contact.linkedinUrl || contact.xUrl || contact.sourceUrl;
}

export function PeopleOutreachCard({ job }: PeopleOutreachCardProps) {
  const [addOpen, setAddOpen] = React.useState(false);
  const [form, setForm] = React.useState<ContactFormState>(() =>
    initialContact(job),
  );
  const [activeAction, setActiveAction] = React.useState<string | null>(null);
  const query = useQuery({
    queryKey: ["jobs", job.id, "people-outreach"],
    queryFn: () => api.getJobPeopleOutreach(job.id),
  });

  const refresh = React.useCallback(async () => {
    await query.refetch();
  }, [query.refetch]);

  const research = async () => {
    setActiveAction("research");
    try {
      const result = await api.researchJobContacts(job.id);
      await refresh();
      if (result.contacts.length > 0) {
        toast.success(
          `Found ${result.contacts.length} evidence-backed ${result.contacts.length === 1 ? "person" : "people"}`,
        );
      } else {
        toast.info("No defensible contact found", {
          description:
            "JobOps kept the list empty instead of guessing. Add a person manually if you have a reliable source.",
        });
      }
      if (result.warnings.length > 0) {
        toast.warning("Some research sources could not be inspected", {
          description: result.warnings.join(" "),
        });
      }
    } catch (error) {
      showErrorToast(error, "Contact research failed");
    } finally {
      setActiveAction(null);
    }
  };

  const addContact = async (event: React.FormEvent) => {
    event.preventDefault();
    setActiveAction("add");
    const input: CreateJobContactInput = {
      name: form.name.trim(),
      title: form.title.trim(),
      company: form.company.trim(),
      role: form.role,
      relationshipStrength: form.role === "warm_referrer" ? "warm" : "unknown",
      relevanceScore: form.role === "warm_referrer" ? 100 : 70,
      relevanceReason: form.relevanceReason.trim(),
      evidenceSummary: form.evidenceSummary.trim(),
      sourceUrl: form.sourceUrl.trim(),
      linkedinUrl: form.linkedinUrl.trim() || null,
      email: form.email.trim() || null,
      emailConfidence: form.email.trim() ? "verified" : "unknown",
      isPrimary: (query.data?.contacts.length ?? 0) === 0,
    };
    try {
      await api.createJobContact(job.id, input);
      await refresh();
      setForm(initialContact(job));
      setAddOpen(false);
      toast.success("Person added");
    } catch (error) {
      showErrorToast(error, "Failed to add person");
    } finally {
      setActiveAction(null);
    }
  };

  const updateContact = async (
    contact: JobContact,
    update: Parameters<typeof api.updateJobContact>[2],
    success: string,
  ) => {
    setActiveAction(`contact-${contact.id}`);
    try {
      await api.updateJobContact(job.id, contact.id, update);
      await refresh();
      toast.success(success);
    } catch (error) {
      showErrorToast(error, "Failed to update person");
    } finally {
      setActiveAction(null);
    }
  };

  const removeContact = async (contact: JobContact) => {
    if (!window.confirm(`Remove ${contact.name} and their outreach records?`))
      return;
    setActiveAction(`contact-${contact.id}`);
    try {
      await api.deleteJobContact(job.id, contact.id);
      await refresh();
      toast.success("Person removed");
    } catch (error) {
      showErrorToast(error, "Failed to remove person");
    } finally {
      setActiveAction(null);
    }
  };

  const draft = async (contact: JobContact) => {
    setActiveAction(`draft-${contact.id}`);
    try {
      await api.draftJobOutreach(job.id, contact.id);
      await refresh();
      toast.success("Editable outreach draft created");
    } catch (error) {
      showErrorToast(error, "Failed to draft outreach");
    } finally {
      setActiveAction(null);
    }
  };

  const contacts = query.data?.contacts ?? [];
  const outreach = query.data?.outreach ?? [];

  return (
    <article className="rounded-xl border border-primary/25 bg-card/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <UserRoundSearch className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">People &amp; outreach</h2>
            <Badge variant="secondary">{contacts.length} found</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {routeGuidance[job.opportunityRoute]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add person
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <form onSubmit={(event) => void addContact(event)}>
                <DialogHeader>
                  <DialogTitle>Add an evidence-backed person</DialogTitle>
                  <DialogDescription>
                    Save where you found them and why they are relevant. A warm
                    referrer must be someone you genuinely know.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-name">Name</Label>
                    <Input
                      id="contact-name"
                      required
                      value={form.name}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          name: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-title">Current title</Label>
                    <Input
                      id="contact-title"
                      required
                      value={form.title}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          title: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-company">Company</Label>
                    <Input
                      id="contact-company"
                      required
                      value={form.company}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          company: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-role">Outreach role</Label>
                    <select
                      id="contact-role"
                      value={form.role}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          role: event.target.value as JobContactRole,
                        }))
                      }
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      {Object.entries(roleLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="contact-source">Evidence source URL</Label>
                    <Input
                      id="contact-source"
                      type="url"
                      required
                      placeholder="https://..."
                      value={form.sourceUrl}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          sourceUrl: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="contact-evidence">
                      What the source proves
                    </Label>
                    <Textarea
                      id="contact-evidence"
                      required
                      rows={3}
                      value={form.evidenceSummary}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          evidenceSummary: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="contact-relevance">
                      Why this person is the right target
                    </Label>
                    <Textarea
                      id="contact-relevance"
                      required
                      rows={3}
                      value={form.relevanceReason}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          relevanceReason: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-linkedin">
                      LinkedIn URL (optional)
                    </Label>
                    <Input
                      id="contact-linkedin"
                      type="url"
                      value={form.linkedinUrl}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          linkedinUrl: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contact-email">
                      Published email (optional)
                    </Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          email: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <DialogFooter className="mt-5">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={activeAction === "add"}>
                    {activeAction === "add" ? "Saving" : "Save person"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button
            size="sm"
            disabled={activeAction === "research"}
            onClick={() => void research()}
          >
            <Search className="mr-1.5 h-3.5 w-3.5" />
            {activeAction === "research" ? "Researching" : "Research people"}
          </Button>
        </div>
      </div>

      {query.isLoading && (
        <p className="mt-4 text-sm text-muted-foreground">
          Loading people and outreach...
        </p>
      )}
      {query.isError && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          People and outreach could not be loaded.{" "}
          <Button size="sm" variant="link" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      )}
      {!query.isLoading && !query.isError && contacts.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-border/60 p-5 text-sm text-muted-foreground">
          No person has been selected. Let JobOps inspect public sources, or add
          someone from a source you trust. It will leave this empty instead of
          emailing the wrong employee.
        </div>
      )}

      {contacts.length > 0 && (
        <ol className="mt-4 space-y-4">
          {contacts.map((contact) => {
            const messages = outreach.filter(
              (message) => message.contactId === contact.id,
            );
            const isBusy =
              activeAction === `contact-${contact.id}` ||
              activeAction === `draft-${contact.id}`;
            return (
              <li key={contact.id}>
                <section className="rounded-lg border border-border/60 bg-background/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{contact.name}</h3>
                        {contact.isPrimary && (
                          <Badge>
                            <Star className="mr-1 h-3 w-3" />
                            Primary
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {roleLabels[contact.role]}
                        </Badge>
                        <Badge variant="secondary">
                          {contact.relevanceScore}/100
                        </Badge>
                        {contact.status !== "candidate" && (
                          <Badge variant="outline">
                            {contact.status.replaceAll("_", " ")}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {contact.title} at {contact.company}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={contactProfileUrl(contact)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Source <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </a>
                      </Button>
                      {!contact.isPrimary &&
                        contact.status !== "not_relevant" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isBusy}
                            onClick={() =>
                              void updateContact(
                                contact,
                                { isPrimary: true },
                                `${contact.name} selected as primary`,
                              )
                            }
                          >
                            <Star className="mr-1.5 h-3.5 w-3.5" />
                            Select
                          </Button>
                        )}
                      {contact.status !== "not_relevant" && (
                        <Button
                          size="sm"
                          disabled={isBusy}
                          onClick={() => void draft(contact)}
                        >
                          <MailPlus className="mr-1.5 h-3.5 w-3.5" />
                          {activeAction === `draft-${contact.id}`
                            ? "Drafting"
                            : "Draft message"}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                    <div className="rounded-md border border-border/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Why this person
                      </p>
                      <p className="mt-1 leading-6">
                        {contact.relevanceReason}
                      </p>
                    </div>
                    <div className="rounded-md border border-border/40 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Evidence
                      </p>
                      <p className="mt-1 leading-6">
                        {contact.evidenceSummary}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {contact.email && (
                      <span>
                        {contact.email} ({contact.emailConfidence})
                      </span>
                    )}
                    {contact.relationshipStrength !== "unknown" && (
                      <span>Relationship: {contact.relationshipStrength}</span>
                    )}
                    {contact.status !== "not_relevant" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() =>
                          void updateContact(
                            contact,
                            { status: "not_relevant", isPrimary: false },
                            "Person marked not relevant",
                          )
                        }
                      >
                        Not relevant
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isBusy}
                        onClick={() =>
                          void updateContact(
                            contact,
                            { status: "candidate" },
                            "Person restored",
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${contact.name}`}
                      disabled={isBusy}
                      onClick={() => void removeContact(contact)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {messages.length > 0 && (
                    <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
                      {messages.map((message) => (
                        <OutreachDraftEditor
                          key={message.id}
                          jobId={job.id}
                          contact={contact}
                          outreach={message}
                          onUpdated={refresh}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
