"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Check,
  Download,
  EyeOff,
  ImagePlus,
  Images,
  LoaderCircle,
  LockKeyhole,
  MonitorUp,
  RotateCcw,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type FaceResult = { embedding?: number[] };
type FaceEngine = {
  load: () => Promise<unknown>;
  warmup: () => Promise<unknown>;
  detect: (input: HTMLImageElement) => Promise<{ face: FaceResult[] }>;
  match: { similarity: (a: number[], b: number[]) => number };
};

type IndexedPhoto = {
  id: string;
  file: File;
  name: string;
  url: string;
  faces: number[][];
};

type PhotoMatch = {
  photo: IndexedPhoto;
  score: number;
  people: { person: number; score: number }[];
};

type Phase = "idle" | "loading" | "indexing" | "ready" | "matching" | "results" | "error";

const MAX_PHOTOS = 50;
const STRONG_THRESHOLD = 0.62;
const POSSIBLE_THRESHOLD = 0.48;

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be read."));
    image.src = url;
  });
}

function formatPercent(score: number) {
  return `${Math.round(score * 100)}%`;
}

export default function Home() {
  const engineRef = useRef<FaceEngine | null>(null);
  const eventInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [view, setView] = useState<"organizer" | "guest">("organizer");
  const [photos, setPhotos] = useState<IndexedPhoto[]>([]);
  const [indexProgress, setIndexProgress] = useState(0);
  const [status, setStatus] = useState("Choose event photos to begin.");
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
  const [selfieName, setSelfieName] = useState("");
  const [queryFaces, setQueryFaces] = useState<number[][]>([]);
  const [matches, setMatches] = useState<PhotoMatch[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const strongMatches = useMemo(
    () => matches.filter((match) => match.score >= STRONG_THRESHOLD && !hiddenIds.has(match.photo.id)),
    [matches, hiddenIds],
  );
  const possibleMatches = useMemo(
    () => matches.filter((match) => match.score >= POSSIBLE_THRESHOLD && match.score < STRONG_THRESHOLD && !hiddenIds.has(match.photo.id)),
    [matches, hiddenIds],
  );

  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("guest");
  }, []);

  const ensureEngine = useCallback(async () => {
    if (engineRef.current) return engineRef.current;
    setPhase("loading");
    setStatus("Loading the private face model…");
    const module = await import("@vladmandic/human");
    const human = new module.default({
      backend: "webgl",
      modelBasePath: "https://vladmandic.github.io/human-models/models/",
      cacheSensitivity: 0,
      filter: { enabled: true, equalization: true },
      face: {
        enabled: true,
        detector: { rotation: true, maxDetected: 12, minConfidence: 0.4 },
        mesh: { enabled: true },
        description: { enabled: true },
        iris: { enabled: false },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
        attention: { enabled: false },
        gear: { enabled: false },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      segmentation: { enabled: false },
      gesture: { enabled: false },
    }) as unknown as FaceEngine;
    await human.load();
    await human.warmup();
    engineRef.current = human;
    return human;
  }, []);

  const detectEmbeddings = useCallback(async (url: string) => {
    const engine = await ensureEngine();
    const image = await loadImage(url);
    const result = await engine.detect(image);
    return result.face.flatMap((face) => (face.embedding ? [face.embedding] : []));
  }, [ensureEngine]);

  const reset = useCallback(() => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    if (selfieUrl) URL.revokeObjectURL(selfieUrl);
    setPhotos([]);
    setSelfieUrl(null);
    setSelfieName("");
    setQueryFaces([]);
    setMatches([]);
    setHiddenIds(new Set());
    setIndexProgress(0);
    setError(null);
    setStatus("Choose event photos to begin.");
    setPhase("idle");
  }, [photos, selfieUrl]);

  useEffect(() => {
    const context = (document as Document & {
      modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "get_photo_finder_status",
      title: "Get photo finder status",
      description: "Read the local gallery and face-match status without changing it.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () => ({ phase, photos: photos.length, queryFaces: queryFaces.length, strongMatches: strongMatches.length, possibleMatches: possibleMatches.length }),
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [phase, photos.length, queryFaces.length, strongMatches.length, possibleMatches.length]);

  const indexFiles = async (selected: FileList | null) => {
    if (!selected?.length) return;
    reset();
    const files = Array.from(selected)
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type))
      .slice(0, MAX_PHOTOS);
    if (!files.length) {
      setError("Choose JPG, PNG, or WebP photos.");
      setPhase("error");
      return;
    }
    try {
      setError(null);
      await ensureEngine();
      setPhase("indexing");
      const indexed: IndexedPhoto[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setStatus(`Checking ${file.name} · ${index + 1} of ${files.length}`);
        const url = URL.createObjectURL(file);
        try {
          const faces = await detectEmbeddings(url);
          indexed.push({ id: `${file.name}-${file.lastModified}-${index}`, file, name: file.name, url, faces });
        } catch {
          indexed.push({ id: `${file.name}-${file.lastModified}-${index}`, file, name: file.name, url, faces: [] });
        }
        setIndexProgress(Math.round(((index + 1) / files.length) * 100));
        setPhotos([...indexed]);
      }
      const faceTotal = indexed.reduce((sum, photo) => sum + photo.faces.length, 0);
      setPhase("ready");
      setStatus(`${indexed.length} photos ready · ${faceTotal} faces found`);
    } catch (caught) {
      setPhase("error");
      setError(caught instanceof Error ? caught.message : "The face model could not start.");
    }
  };

  const processSelfie = async (selected: FileList | null) => {
    const file = selected?.[0];
    if (!file) return;
    if (selfieUrl) URL.revokeObjectURL(selfieUrl);
    const url = URL.createObjectURL(file);
    setSelfieUrl(url);
    setSelfieName(file.name);
    setMatches([]);
    setHiddenIds(new Set());
    setPhase("matching");
    setError(null);
    setStatus("Finding faces in the selfie…");
    try {
      const faces = await detectEmbeddings(url);
      if (!faces.length) throw new Error("No clear face was found. Try a brighter, front-facing photo.");
      setQueryFaces(faces);
      setStatus(`Comparing ${faces.length} ${faces.length === 1 ? "face" : "faces"} with the event gallery…`);
      const engine = engineRef.current;
      if (!engine) throw new Error("The face model is not ready.");
      const ranked = photos
        .filter((photo) => photo.faces.length > 0)
        .map((photo) => {
          const people = faces.map((query, person) => ({
            person: person + 1,
            score: Math.max(...photo.faces.map((candidate) => engine.match.similarity(query, candidate))),
          })).filter((person) => person.score >= POSSIBLE_THRESHOLD);
          return { photo, people, score: people.length ? Math.max(...people.map((person) => person.score)) : 0 };
        })
        .filter((match) => match.score >= POSSIBLE_THRESHOLD)
        .sort((a, b) => b.score - a.score);
      setMatches(ranked);
      setPhase("results");
      setStatus(`${ranked.length} likely ${ranked.length === 1 ? "photo" : "photos"} found`);
    } catch (caught) {
      setPhase("ready");
      setQueryFaces([]);
      setError(caught instanceof Error ? caught.message : "The selfie could not be processed.");
      setStatus("Try another selfie.");
    }
  };

  const removePhoto = (id: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((photo) => photo.id !== id);
    });
    setMatches((current) => current.filter((match) => match.photo.id !== id));
  };

  const hidePhoto = (id: string) => setHiddenIds((current) => new Set(current).add(id));

  const downloadPhoto = (photo: IndexedPhoto) => {
    const anchor = document.createElement("a");
    anchor.href = photo.url;
    anchor.download = photo.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const resultCount = strongMatches.length + possibleMatches.length;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><ScanFace className="h-5 w-5" aria-hidden="true" /></span>
            <div><p className="font-display text-lg font-semibold leading-none">FindMyFrame</p><p className="mt-1 text-xs text-muted-foreground">Local event photo finder</p></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground sm:inline-flex"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />Photos stay on this device</span>
            <div className="flex rounded-xl border border-border bg-card p-1">
              <Button variant={view === "organizer" ? "secondary" : "ghost"} size="sm" onClick={() => setView("organizer")} aria-pressed={view === "organizer"}><MonitorUp /> <span className="hidden sm:inline">Organizer</span></Button>
              <Button variant={view === "guest" ? "secondary" : "ghost"} size="sm" onClick={() => setView("guest")} aria-pressed={view === "guest"}><Smartphone /> <span className="hidden sm:inline">Guest view</span></Button>
            </div>
            {photos.length > 0 && <Button variant="ghost" size="sm" onClick={reset}><RotateCcw />Reset</Button>}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10">
        <div className="grid gap-6 lg:grid-cols-[.72fr_1.28fr]">
          <aside className={`rounded-[2rem] bg-primary p-6 text-primary-foreground sm:p-8 lg:sticky lg:top-24 lg:h-[calc(100vh-7.5rem)] lg:min-h-[610px] ${view === "guest" ? "max-sm:rounded-[1.6rem]" : ""}`}>
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.12em] text-white/75">Demo event</span>
                <span className="text-sm text-white/60">{photos.length} / {MAX_PHOTOS}</span>
              </div>
              <h1 className={`font-display font-semibold leading-[1.02] tracking-[-.04em] sm:text-5xl lg:text-6xl ${view === "guest" ? "mt-7 text-4xl" : "mt-10 text-4xl"}`}>{view === "organizer" ? "Prepare the gallery from your computer." : "Your photos are one selfie away."}</h1>
              <p className="mt-5 max-w-md text-base leading-7 text-white/68">{view === "organizer" ? "Upload and index the photographer’s images, then preview the guest experience before sharing the event." : "Take a clear selfie and we’ll look only inside this event for your strongest photo matches."}</p>

              <div className={`mt-8 space-y-3 ${view === "guest" ? "max-sm:hidden" : ""}`}>
                {(view === "organizer" ? [
                  ["1", "Upload from computer", photos.length ? `${photos.length} photos indexed` : "Waiting for photos", photos.length > 0],
                  ["2", "Review gallery", photos.length ? "Remove any unwanted image" : "Available after upload", photos.length > 0],
                  ["3", "Preview guest view", photos.length ? "Ready to test" : "Available after indexing", false],
                ] : [
                  ["1", "Take a selfie", queryFaces.length ? `${queryFaces.length} faces ready` : "Camera opens on your phone", queryFaces.length > 0],
                  ["2", "Private search", phase === "matching" ? "Comparing faces" : "This event only", phase === "results"],
                  ["3", "Save your photos", phase === "results" ? `${resultCount} results` : "Download full resolution", false],
                ]).map(([number, label, detail, done]) => (
                  <div key={String(number)} className="flex items-center gap-4 rounded-2xl bg-white/[.07] p-4">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold ${done ? "bg-accent text-white" : "bg-white/10 text-white/70"}`}>{done ? <Check className="h-4 w-4" /> : number}</span>
                    <div><p className="text-sm font-semibold">{label}</p><p className="mt-0.5 text-xs text-white/55">{detail}</p></div>
                  </div>
                ))}
              </div>

              <div className={`mt-auto grid grid-cols-2 gap-3 pt-8 text-xs leading-5 text-white/55 ${view === "guest" ? "max-sm:hidden" : ""}`}>
                <p className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-white/75" />{view === "organizer" ? "Local processing" : "Event-only search"}</p>
                <p className="flex gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-white/75" />{view === "organizer" ? "50-photo demo" : "Group selfies supported"}</p>
              </div>
            </div>
          </aside>

          <div className="space-y-6">
            {view === "organizer" && <section className="rounded-[2rem] border border-border bg-card p-5 shadow-[0_20px_70px_rgba(22,31,26,.06)] sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-sm font-semibold text-accent">Step 1</p><h2 className="font-display mt-1 text-2xl font-semibold tracking-tight">Add event photos</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Choose up to 50 JPG, PNG, or WebP images. Clear, front-facing photos work best.</p></div>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Images className="h-5 w-5" aria-hidden="true" /></span>
              </div>

              {!photos.length && phase !== "indexing" && phase !== "loading" ? (
                <button type="button" onClick={() => eventInputRef.current?.click()} className="mt-7 flex min-h-56 w-full flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-muted/55 px-6 text-center outline-none transition hover:border-accent hover:bg-muted focus-visible:ring-4 focus-visible:ring-ring/20">
                  <span className="grid h-14 w-14 place-items-center rounded-2xl bg-background shadow-sm"><ImagePlus className="h-6 w-6" aria-hidden="true" /></span>
                  <span className="mt-4 font-semibold">Choose event photos</span><span className="mt-1 text-sm text-muted-foreground">You can select the entire folder batch at once</span>
                </button>
              ) : (
                <div className="mt-7">
                  {(phase === "loading" || phase === "indexing") && <div className="rounded-2xl bg-secondary/65 p-4"><div className="flex items-center justify-between gap-4 text-sm"><span className="flex items-center gap-2 font-medium"><LoaderCircle className="h-4 w-4 animate-spin" />{status}</span><strong>{indexProgress}%</strong></div><Progress value={indexProgress} className="mt-3" /></div>}
                  {photos.length > 0 && <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {photos.map((photo) => <figure key={photo.id} className="group relative aspect-square overflow-hidden rounded-xl bg-muted"><img src={photo.url} alt={photo.name} className="h-full w-full object-cover" /><figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-7 text-[11px] text-white">{photo.faces.length} {photo.faces.length === 1 ? "face" : "faces"}</figcaption><button type="button" onClick={() => removePhoto(photo.id)} aria-label={`Remove ${photo.name}`} className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-100 backdrop-blur transition hover:bg-destructive sm:opacity-0 sm:group-hover:opacity-100"><X className="h-3.5 w-3.5" /></button></figure>)}
                  </div>}
                </div>
              )}
              <input ref={eventInputRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void indexFiles(event.target.files)} />
              {photos.length > 0 && phase !== "indexing" && phase !== "loading" && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary/65 px-4 py-3 text-sm"><span className="text-muted-foreground">{status}</span><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => eventInputRef.current?.click()}><Upload />Replace gallery</Button><Button size="sm" onClick={() => setView("guest")}><Smartphone />Preview guest view</Button></div></div>}
            </section>}

            {view === "guest" && photos.length === 0 && (
              <section className="rounded-[2rem] border border-border bg-card p-6 text-center shadow-[0_20px_70px_rgba(22,31,26,.06)] sm:p-10">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-secondary"><Images className="h-7 w-7" /></span>
                <h2 className="font-display mt-5 text-2xl font-semibold">This demo event is not ready yet</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">For this local demo, prepare the gallery in the organizer view first. The production version will load the event automatically when guests scan its QR code.</p>
                <Button className="mt-6" onClick={() => setView("organizer")}><MonitorUp />Go to organizer setup</Button>
              </section>
            )}

            {view === "guest" && photos.length > 0 && phase !== "indexing" && phase !== "loading" && (
              <section className="rounded-[2rem] border border-border bg-card p-5 shadow-[0_20px_70px_rgba(22,31,26,.06)] sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <div><p className="text-sm font-semibold text-accent">Step 2</p><h2 className="font-display mt-1 text-2xl font-semibold tracking-tight">Add a selfie</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">One person or a group is fine. Everyone pictured should agree to the search.</p></div>
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Camera className="h-5 w-5" aria-hidden="true" /></span>
                </div>
                <div className="mt-7 grid gap-4 sm:grid-cols-[180px_1fr]">
                  <button type="button" onClick={() => selfieInputRef.current?.click()} className="relative flex aspect-square min-h-44 items-center justify-center overflow-hidden rounded-[1.5rem] border border-dashed border-border bg-muted/55 outline-none transition hover:border-accent focus-visible:ring-4 focus-visible:ring-ring/20">
                    {selfieUrl ? <img src={selfieUrl} alt="Selected selfie" className="h-full w-full object-cover" /> : <span className="flex flex-col items-center px-4 text-center"><Camera className="h-7 w-7" /><span className="mt-3 text-sm font-semibold">Take or choose selfie</span></span>}
                    {phase === "matching" && <span className="absolute inset-0 grid place-items-center bg-primary/75 text-white backdrop-blur-sm"><LoaderCircle className="h-8 w-8 animate-spin" /></span>}
                  </button>
                  <div className="flex flex-col justify-center rounded-[1.5rem] bg-muted/55 p-5">
                    {selfieUrl ? <><p className="font-semibold">{selfieName}</p><p className="mt-1 text-sm text-muted-foreground">{phase === "matching" ? status : queryFaces.length ? `${queryFaces.length} ${queryFaces.length === 1 ? "person" : "people"} detected` : status}</p></> : <><p className="font-semibold">Ready when you are</p><p className="mt-1 text-sm leading-6 text-muted-foreground">Use a clear photo with visible faces. The selfie is kept only in this browser tab.</p></>}
                    <Button className="mt-5 w-fit bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => selfieInputRef.current?.click()} disabled={phase === "matching"}><Camera />{selfieUrl ? "Try another selfie" : "Choose selfie"}</Button>
                  </div>
                </div>
                <input ref={selfieInputRef} className="sr-only" type="file" accept="image/*" capture="user" onChange={(event) => void processSelfie(event.target.files)} />
              </section>
            )}

            {error && <div role="alert" className="rounded-2xl border border-destructive/25 bg-red-50 px-5 py-4 text-sm text-red-800"><strong>Couldn’t complete that step.</strong><p className="mt-1">{error}</p></div>}

            {view === "guest" && phase === "results" && (
              <section className="rounded-[2rem] border border-border bg-card p-5 shadow-[0_20px_70px_rgba(22,31,26,.06)] sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-accent">Step 3</p><h2 className="font-display mt-1 text-2xl font-semibold tracking-tight">Your likely photos</h2><p className="mt-2 text-sm text-muted-foreground">Review possible matches before downloading.</p></div><span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-accent" />{resultCount} found</span></div>

                {resultCount === 0 ? <div className="mt-7 rounded-[1.5rem] bg-muted/55 px-6 py-12 text-center"><ScanFace className="mx-auto h-9 w-9 text-muted-foreground" /><h3 className="mt-4 font-semibold">No close matches yet</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Try another selfie with brighter light and a more front-facing angle.</p></div> : <div className="mt-8 space-y-9">
                  <MatchGroup title="Strong matches" description="Highest-confidence results" matches={strongMatches} onDownload={downloadPhoto} onHide={hidePhoto} />
                  <MatchGroup title="Possible matches" description="Worth a quick visual check" matches={possibleMatches} onDownload={downloadPhoto} onHide={hidePhoto} />
                </div>}
                {hiddenIds.size > 0 && <button type="button" onClick={() => setHiddenIds(new Set())} className="mt-6 text-sm font-semibold text-accent underline-offset-4 hover:underline">Restore {hiddenIds.size} hidden {hiddenIds.size === 1 ? "photo" : "photos"}</button>}
              </section>
            )}

            <footer className="flex flex-col gap-2 px-2 pb-8 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>Local demo · Face similarity is an aid, not identity proof.</p><p>No accounts · No API keys · Refresh clears the session</p></footer>
          </div>
        </div>
      </section>
    </main>
  );
}

function MatchGroup({ title, description, matches, onDownload, onHide }: { title: string; description: string; matches: PhotoMatch[]; onDownload: (photo: IndexedPhoto) => void; onHide: (id: string) => void }) {
  if (!matches.length) return null;
  return <div><div className="mb-4 flex items-end justify-between"><div><h3 className="font-display text-xl font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><span className="text-sm font-semibold">{matches.length}</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{matches.map((match) => <article key={match.photo.id} className="group overflow-hidden rounded-[1.25rem] border border-border bg-background"><div className="relative aspect-[4/3] overflow-hidden bg-muted"><img src={match.photo.url} alt={match.photo.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" /><span className="absolute left-3 top-3 rounded-full bg-primary/90 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">{formatPercent(match.score)} match</span></div><div className="p-3.5"><p className="truncate text-sm font-semibold" title={match.photo.name}>{match.photo.name}</p><div className="mt-2 flex flex-wrap gap-1.5">{match.people.map((person) => <span key={person.person} className="rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-secondary-foreground">Person {person.person} · {formatPercent(person.score)}</span>)}</div><div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><Button size="sm" onClick={() => onDownload(match.photo)}><Download />Download</Button><Button size="icon-sm" variant="outline" aria-label={`Hide ${match.photo.name}`} onClick={() => onHide(match.photo.id)}><EyeOff /></Button></div></div></article>)}</div></div>;
}
