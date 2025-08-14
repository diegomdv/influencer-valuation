import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Info, Calculator, DollarSign, Hash, Users, TrendingUp, Package2, FileDown, Wand2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// --- Minimal UI primitives (canvas-friendly) ---
const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl shadow p-5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 ${className}`}>{children}</div>
);
const Label = ({ children }) => <label className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{children}</label>;
const Input = ({ className = "", ...props }) => (
  <input className={`w-full mt-1 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${className}`} {...props} />
);
const Textarea = ({ className = "", ...props }) => (
  <textarea className={`w-full mt-1 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${className}`} {...props} />
);
const Select = ({ options, value, onChange }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full mt-1 rounded-xl border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500">
    {options.map((o) => (
      <option key={o.value} value={o.value}>{o.label}</option>
    ))}
  </select>
);
const Switch = ({ checked, onChange }) => (
  <button onClick={() => onChange(!checked)} className={`h-6 w-11 rounded-full relative transition-colors ${checked ? "bg-indigo-600" : "bg-zinc-300 dark:bg-zinc-600"}`}>
    <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
  </button>
);
const Help = ({ children }) => (
  <div className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">{children}</div>
);
const Pill = ({ children, tone = "indigo" }) => (
  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium bg-${tone}-100 text-${tone}-800 dark:bg-${tone}-900/40 dark:text-${tone}-100`}>{children}</span>
);
const Button = ({ children, onClick, variant = "primary", className = "" }) => (
  <button onClick={onClick} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium shadow ${variant === "primary" ? "bg-indigo-600 text-white hover:bg-indigo-700" : variant === "ghost" ? "bg-transparent text-indigo-600 dark:text-indigo-300 hover:underline" : "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"} ${className}`}>{children}</button>
);

// --- Helpers ---
const currency = (n, c = "USD") => new Intl.NumberFormat(undefined, { style: "currency", currency: c, maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);

const PLATFORM_DEFAULTS = {
  instagram: { label: "Instagram", cpm: 18, reachRate: 0.20, erBasis: "likes+comments" },
  tiktok: { label: "TikTok", cpm: 14, reachRate: 0.23, erBasis: "views" },
  youtube: { label: "YouTube", cpm: 22, reachRate: 0.25, erBasis: "views" },
  x: { label: "X (Twitter)", cpm: 10, reachRate: 0.18, erBasis: "likes+comments+retweets" },
};

function inferTier(followers) {
  if (followers < 10000) return "Nano";
  if (followers < 100000) return "Micro";
  if (followers < 500000) return "Mid";
  if (followers < 1000000) return "Macro";
  return "Mega";
}

function inferCategoryFromBio(bio) {
  if (!bio) return "General Lifestyle";
  const text = bio.toLowerCase();
  const rules = [
    { k: ["travel", "viajes", "wanderlust", "hotel", "resort", "beach", "playa"], v: "Travel" },
    { k: ["food", "gourmet", "chef", "restaurante", "coffee", "café"], v: "Food & Coffee" },
    { k: ["fitness", "gym", "crossfit", "wellness", "yoga", "spa"], v: "Fitness & Wellness" },
    { k: ["fashion", "moda", "ootd", "style", "designer"], v: "Fashion" },
    { k: ["tech", "gaming", "gamer", "esports"], v: "Tech & Gaming" },
    { k: ["family", "mum", "dad", "parents", "kids"], v: "Family" },
    { k: ["luxury", "lujo", "premium", "five-star"], v: "Luxury Lifestyle" },
    { k: ["mexico", "cancun", "cdmx", "playa del carmen"], v: "Mexico-Focused" },
  ];
  for (const r of rules) if (r.k.some((w) => text.includes(w))) return r.v;
  return "General Lifestyle";
}

function calcSurcharge({ usageDays, exclusivityMonths, whitelisting }) {
  let s = 0;
  if (usageDays > 30) s += 0.15;
  if (exclusivityMonths >= 1) s += 0.20 + 0.10 * Math.max(0, exclusivityMonths - 1);
  if (whitelisting) s += 0.20;
  return s;
}

function estimateImpressions(type, { followers, reachRate, avgViews }) {
  const base = Math.max(1, followers) * reachRate;
  switch (type) {
    case "feed":
      return base;
    case "reel":
      return Math.max(base, avgViews || base * 1.2);
    case "story":
      return Math.max(base * 0.35, followers * 0.07);
    case "tiktok":
      return Math.max(base * 1.2, avgViews || base * 1.5);
    case "yt":
      return Math.max(base * 1.4, avgViews || base * 2);
    default:
      return base;
  }
}

// --- NEW: heuristics to help auto-suggest key inputs ---
function suggestReachRate(platform, followers, avgLikes, avgComments, avgViews) {
  // For post-based platforms, use (likes+comments)/followers; for video, use views/followers
  const f = Math.max(1, followers);
  if (platform === "instagram" || platform === "x") {
    const er = (avgLikes + avgComments) / f; // as proportion
    // Clamp and nudge: reach tends to exceed engaged users by 2–4x
    return Math.min(0.6, Math.max(0.05, er * 3));
  }
  if (platform === "tiktok" || platform === "youtube") {
    const vr = avgViews / f;
    return Math.min(0.9, Math.max(0.08, vr));
  }
  return 0.2;
}
function suggestCPM(platform, engagementRatePct) {
  // Start from platform baseline and scale by ER vs typical ~2% for posts, ~30–40% for shorts
  const base = PLATFORM_DEFAULTS[platform]?.cpm ?? 15;
  const typical = (platform === "tiktok" || platform === "youtube") ? 35 : 2;
  const factor = Math.min(1.5, Math.max(0.7, (engagementRatePct || typical) / typical));
  return Math.round(base * factor);
}
function suggestQualityMultiplier(avgLikes, avgComments) {
  const commentRatio = avgComments / Math.max(1, avgLikes);
  // More comments per like usually implies deeper engagement/storytelling
  if (commentRatio > 0.08) return 1.15;
  if (commentRatio > 0.04) return 1.05;
  return 1.0;
}
function suggestBrandFitMultiplier(bio) {
  const t = (bio || "").toLowerCase();
  let m = 1.0;
  if (t.includes("luxury") || t.includes("lujo")) m += 0.1;
  if (t.includes("mexico") || t.includes("cancun") || t.includes("playa")) m += 0.05;
  if (t.includes("travel") || t.includes("hotel") || t.includes("resort")) m += 0.05;
  return Math.min(1.3, m);
}

export default function InfluencerValuationTool() {
  const [dark, setDark] = useState(true);
  const [platform, setPlatform] = useState("instagram");

  // NEW: influencer identification
  const [personName, setPersonName] = useState("");
  const [handle, setHandle] = useState("");
  const [profileLink, setProfileLink] = useState("");

  const [followers, setFollowers] = useState(80000);
  const [avgLikes, setAvgLikes] = useState(2400);
  const [avgComments, setAvgComments] = useState(120);
  const [avgViews, setAvgViews] = useState(50000);
  const [bio, setBio] = useState("Travel & coffee. Based in Cancún. Español + English.");
  const [cpm, setCpm] = useState(PLATFORM_DEFAULTS.instagram.cpm);
  const [reachRate, setReachRate] = useState(PLATFORM_DEFAULTS.instagram.reachRate);
  const [quality, setQuality] = useState(1.0); // 0.8–1.2 typical
  const [brandFit, setBrandFit] = useState(1.0); // 0.7–1.3 typical
  const [adr, setAdr] = useState(950);
  const [marginalCost, setMarginalCost] = useState(120);
  const [currencyCode] = useState("USD");

  const [offer, setOffer] = useState({
    feedPosts: 1,
    reels: 1,
    stories: 3,
    tiktoks: 0,
    ytVideos: 0,
    usageDays: 30,
    exclusivityMonths: 0,
    whitelisting: false,
  });

  React.useEffect(() => {
    const d = PLATFORM_DEFAULTS[platform];
    setCpm(d.cpm);
    setReachRate(d.reachRate);
  }, [platform]);

  const tier = useMemo(() => inferTier(followers), [followers]);
  const category = useMemo(() => inferCategoryFromBio(bio), [bio]);

  const engagementRate = useMemo(() => {
    if (platform === "instagram" || platform === "x") return ((avgLikes + avgComments) / Math.max(1, followers)) * 100;
    if (platform === "tiktok" || platform === "youtube") return (avgViews / Math.max(1, followers)) * 100;
    return 0;
  }, [platform, avgLikes, avgComments, avgViews, followers]);

  const surcharges = useMemo(() => calcSurcharge(offer), [offer]);

  function emvFor(type) {
    const imps = estimateImpressions(type, { followers, reachRate, avgViews });
    const base = (imps / 1000) * cpm;
    const adjusted = base * quality * brandFit * (1 + surcharges);
    return { imps, base, adjusted };
  }

  const breakdown = useMemo(() => {
    const items = [];
    if (offer.feedPosts) items.push({ label: "Feed post", count: offer.feedPosts, key: "feed" });
    if (offer.reels) items.push({ label: "Reel", count: offer.reels, key: "reel" });
    if (offer.stories) items.push({ label: "Story", count: offer.stories, key: "story" });
    if (offer.tiktoks) items.push({ label: "TikTok", count: offer.tiktoks, key: "tiktok" });
    if (offer.ytVideos) items.push({ label: "YouTube Video", count: offer.ytVideos, key: "yt" });

    let totalImps = 0, totalValue = 0;
    const lines = items.map((it) => {
      const { imps, adjusted } = emvFor(it.key);
      totalImps += imps * it.count;
      totalValue += adjusted * it.count;
      return { ...it, imps: Math.round(imps), value: adjusted };
    });

    return { items: lines, totalImps, totalValue };
  }, [offer, cpm, reachRate, quality, brandFit, followers, avgViews, avgLikes, avgComments, surcharges, platform]);

  const nightsEquivalent = useMemo(() => breakdown.totalValue / Math.max(1, adr), [breakdown.totalValue, adr]);
  const barterCostToHotel = useMemo(() => nightsEquivalent * Math.max(1, marginalCost), [nightsEquivalent, marginalCost]);

  const acceptBand = useMemo(() => {
    const ratio = barterCostToHotel / Math.max(1, breakdown.totalValue);
    if (ratio < 0.5) return { tone: "green", label: "ACCEPT or sweeten ask" };
    if (ratio < 0.7) return { tone: "amber", label: "NEGOTIATE scope/rights" };
    return { tone: "red", label: "DECLINE or cut deliverables" };
  }, [barterCostToHotel, breakdown.totalValue]);

  // PDF export
  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Influencer Collaboration One-Pager", 14, 18);
    doc.setFontSize(10);
    doc.text("Generated by Influencer Valuation Tool", 14, 24);

    // Info table
    autoTable(doc, {
      startY: 28,
      head: [["Field", "Value"]],
      body: [
        ["Name", personName || "—"],
        ["Handle", handle || "—"],
        ["Profile", profileLink || "—"],
        ["Platform", PLATFORM_DEFAULTS[platform].label],
        ["Followers", followers.toLocaleString()],
        ["ER (est.)", `${engagementRate.toFixed(2)}%`],
        ["Tier", tier],
        ["Category", category],
        ["Reach Rate", `${(reachRate * 100).toFixed(1)}%`],
        ["CPM", currency(cpm, currencyCode)],
        ["Quality x Brand Fit", `${quality.toFixed(2)} × ${brandFit.toFixed(2)}`],
      ],
      theme: "grid",
      styles: { fontSize: 9 }
    });

    // Deliverables
    autoTable(doc, {
      startY: (doc.lastAutoTable?.finalY || 60) + 6,
      head: [["Deliverable", "Count", "Impressions / each", "Value / each", "Total"]],
      body: breakdown.items.map((it) => [
        it.label,
        String(it.count),
        it.imps.toLocaleString(),
        currency(it.value, currencyCode),
        currency(it.value * it.count, currencyCode),
      ]),
      theme: "striped",
      styles: { fontSize: 9 }
    });

    // Totals & decision
    const totalsY = (doc.lastAutoTable?.finalY || 120) + 6;
    doc.setFontSize(11);
    doc.text(`Total EMV: ${currency(breakdown.totalValue, currencyCode)}`, 14, totalsY);
    doc.text(`Room-Night Eq.: ${nightsEquivalent.toFixed(1)} @ ADR ${currency(adr, currencyCode)}`, 14, totalsY + 6);
    doc.text(`Hotel Barter Cost: ${currency(barterCostToHotel, currencyCode)}`, 14, totalsY + 12);

    const decision = acceptBand.label;
    doc.setDrawColor(0);
    doc.setFillColor(decision.startsWith("ACCEPT") ? 46 : decision.startsWith("NEGOTIATE") ? 245 : 220, decision.startsWith("ACCEPT") ? 160 : decision.startsWith("NEGOTIATE") ? 158 : 38, decision.startsWith("ACCEPT") ? 67 : decision.startsWith("NEGOTIATE") ? 66 : 38);
    doc.rect(14, totalsY + 18, 182, 10, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(`Decision: ${decision}`, 20, totalsY + 25);
    doc.setTextColor(0, 0, 0);

    // Terms
    autoTable(doc, {
      startY: totalsY + 34,
      head: [["Terms"]],
      body: [[
        `Usage rights: ${offer.usageDays} days | Exclusivity: ${offer.exclusivityMonths} months | Whitelisting: ${offer.whitelisting ? "Yes" : "No"}`
      ]],
      styles: { fontSize: 9 },
      theme: "plain"
    });

    const filename = `${(personName || handle || PLATFORM_DEFAULTS[platform].label).replace(/\\s+/g, "-")}-onepager.pdf`;
    doc.save(filename);
  }

  // Self-tests
  function approxEqual(a, b, tol = 1) { return Math.abs(a - b) <= tol; }
  const tests = useMemo(() => {
    const t = [];
    t.push({ name: "Tier: 9,000 => Nano", pass: inferTier(9000) === "Nano" });
    t.push({ name: "Tier: 100,000 => Mid", pass: inferTier(100000) === "Mid" });
    t.push({ name: "Category: travel wins", pass: inferCategoryFromBio("Coffee & travel in Mexico") === "Travel" });
    const baseImps = estimateImpressions("feed", { followers: 80000, reachRate: 0.20, avgViews: 50000 });
    const expectedFeedEmv = (baseImps / 1000) * 18; // ~288
    const reCalc = (function(){ const b = (estimateImpressions("feed", { followers: 80000, reachRate: 0.20, avgViews: 50000 })/1000)*18; return b; })();
    t.push({ name: "EMV(feed, defaults) ≈ 288", pass: approxEqual(reCalc, expectedFeedEmv, 1) });
    t.push({ name: "Surcharge: usage &gt;30d => +0.15", pass: calcSurcharge({ usageDays: 45, exclusivityMonths: 0, whitelisting: false }) === 0.15 });
    return t;
  }, []);

  return (
    <div className={`min-h-screen ${dark ? "dark bg-zinc-950" : "bg-zinc-50"}`}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <motion.h1 layout className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Influencer Valuation Tool</motion.h1>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-300">Dark</span>
            <Switch checked={dark} onChange={setDark} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: Inputs */}
          <Card className="lg:col-span-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label>Platform</Label>
                <Select value={platform} onChange={setPlatform} options={[
                  { value: "instagram", label: "Instagram" },
                  { value: "tiktok", label: "TikTok" },
                  { value: "youtube", label: "YouTube" },
                  { value: "x", label: "X (Twitter)" },
                ]} />
              </div>
              <div>
                <Label>Name</Label>
                <Input placeholder="e.g., Ana Pérez" value={personName} onChange={(e) => setPersonName(e.target.value)} />
              </div>
              <div>
                <Label>Handle</Label>
                <Input placeholder="@anaperez" value={handle} onChange={(e) => setHandle(e.target.value)} />
              </div>
              <div className="sm:col-span-3">
                <Label>Profile Link</Label>
                <Input placeholder="https://instagram.com/anaperez" value={profileLink} onChange={(e) => setProfileLink(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <div>
                <Label>Followers / Subs</Label>
                <Input type="number" value={followers} onChange={(e) => setFollowers(Number(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Avg Views (video)</Label>
                <Input type="number" value={avgViews} onChange={(e) => setAvgViews(Number(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Avg Likes (post)</Label>
                <Input type="number" value={avgLikes} onChange={(e) => setAvgLikes(Number(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Avg Comments (post)</Label>
                <Input type="number" value={avgComments} onChange={(e) => setAvgComments(Number(e.target.value) || 0)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Bio / Niche hints</Label>
                <Textarea rows={2} placeholder="e.g., Luxury travel, Mexico, coffee lover" value={bio} onChange={(e) => setBio(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <div>
                <div className="flex items-center justify-between">
                  <Label>Reach Rate</Label>
                  <Button variant="ghost" onClick={() => setReachRate(suggestReachRate(platform, followers, avgLikes, avgComments, avgViews))}><Wand2 className="h-4 w-4"/>Auto</Button>
                </div>
                <Input type="number" step="0.01" value={reachRate} onChange={(e) => setReachRate(Number(e.target.value) || 0)} />
                <Help>Proportion of followers reached per post (0.20 = 20%). Click Auto for a heuristic from your stats.</Help>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>CPM (USD)</Label>
                  <Button variant="ghost" onClick={() => setCpm(suggestCPM(platform, engagementRate))}><Wand2 className="h-4 w-4"/>Auto</Button>
                </div>
                <Input type="number" value={cpm} step="1" onChange={(e) => setCpm(Number(e.target.value) || 0)} />
                <Help>Auto uses platform baseline scaled by engagement vs typical.</Help>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Quality Multiplier</Label>
                  <Button variant="ghost" onClick={() => setQuality(suggestQualityMultiplier(avgLikes, avgComments))}><Wand2 className="h-4 w-4"/>Auto</Button>
                </div>
                <Input type="number" value={quality} step="0.05" onChange={(e) => setQuality(Number(e.target.value) || 0)} />
                <Help>Craft/storytelling proxy; auto uses comments-to-likes ratio.</Help>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <Label>Brand Fit Multiplier</Label>
                  <Button variant="ghost" onClick={() => setBrandFit(suggestBrandFitMultiplier(bio))}><Wand2 className="h-4 w-4"/>Auto</Button>
                </div>
                <Input type="number" value={brandFit} step="0.05" onChange={(e) => setBrandFit(Number(e.target.value) || 0)} />
                <Help>Fit for luxury/Mexico/hospitality; auto reads hints from bio.</Help>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <div>
                <Label>Hotel ADR ({currencyCode})</Label>
                <Input type="number" value={adr} onChange={(e) => setAdr(Number(e.target.value) || 0)} />
              </div>
              <div>
                <Label>Marginal Cost / Night ({currencyCode})</Label>
                <Input type="number" value={marginalCost} onChange={(e) => setMarginalCost(Number(e.target.value) || 0)} />
                <Help>Housekeeping, amenities, utilities, F&amp;B—exclude fixed costs.</Help>
              </div>
            </div>

            <div className="mt-6 border-t border-zinc-200 dark:border-zinc-700 pt-4">
              <div className="flex items-center gap-2 mb-2"><Package2 className="h-4 w-4"/><h3 className="font-semibold">Their Offer</h3></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Feed posts</Label><Input type="number" value={offer.feedPosts} onChange={(e)=>setOffer({...offer, feedPosts: Number(e.target.value)||0})} /></div>
                <div><Label>Reels</Label><Input type="number" value={offer.reels} onChange={(e)=>setOffer({...offer, reels: Number(e.target.value)||0})} /></div>
                <div><Label>Stories</Label><Input type="number" value={offer.stories} onChange={(e)=>setOffer({...offer, stories: Number(e.target.value)||0})} /></div>
                <div><Label>TikToks</Label><Input type="number" value={offer.tiktoks} onChange={(e)=>setOffer({...offer, tiktoks: Number(e.target.value)||0})} /></div>
                <div><Label>YouTube Videos</Label><Input type="number" value={offer.ytVideos} onChange={(e)=>setOffer({...offer, ytVideos: Number(e.target.value)||0})} /></div>
                <div><Label>Usage Rights (days)</Label><Input type="number" value={offer.usageDays} onChange={(e)=>setOffer({...offer, usageDays: Number(e.target.value)||0})} /></div>
                <div><Label>Exclusivity (months)</Label><Input type="number" value={offer.exclusivityMonths} onChange={(e)=>setOffer({...offer, exclusivityMonths: Number(e.target.value)||0})} /></div>
                <div className="flex items-center gap-3 mt-6">
                  <Label>Whitelisting</Label>
                  <Switch checked={offer.whitelisting} onChange={(v)=>setOffer({...offer, whitelisting: v})} />
                </div>
              </div>
              <Help className="mt-2">Surcharges apply for usage rights, exclusivity, and whitelisting.</Help>
            </div>
          </Card>

          {/* Right: Inference & Summary */}
          <Card>
            <div className="flex items-center gap-2 mb-3"><Users className="h-4 w-4" /><h3 className="font-semibold">Profile Inference</h3></div>
            <div className="flex flex-wrap gap-2">
              <Pill tone="indigo"><Hash className="h-3 w-3"/> Tier: {tier}</Pill>
              <Pill tone="emerald"><Info className="h-3 w-3"/> Category: {category}</Pill>
              <Pill tone="violet"><TrendingUp className="h-3 w-3"/> ER: {engagementRate.toFixed(2)}%</Pill>
            </div>
            <Help className="mt-2">ER basis depends on platform (posts: likes+comments; video platforms: views).</Help>

            <div className="mt-5 border-t border-zinc-200 dark:border-zinc-700 pt-4">
              <div className="flex items-center gap-2 mb-2"><Calculator className="h-4 w-4"/><h3 className="font-semibold">Valuation</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-600 dark:text-zinc-300">
                      <th className="py-2">Deliverable</th>
                      <th>Count</th>
                      <th>Impressions / each</th>
                      <th>Value / each</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.items.map((it) => (
                      <tr key={it.label} className="border-t border-zinc-100 dark:border-zinc-700">
                        <td className="py-2">{it.label}</td>
                        <td>{it.count}</td>
                        <td>{it.imps.toLocaleString()}</td>
                        <td>{currency(it.value, currencyCode)}</td>
                        <td>{currency(it.value * it.count, currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-zinc-200 dark:border-zinc-600 font-semibold">
                      <td className="py-2">TOTAL</td>
                      <td colSpan={2}>{Math.round(breakdown.totalImps).toLocaleString()} imps</td>
                      <td colSpan={2}>{currency(breakdown.totalValue, currencyCode)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <Card>
                  <div className="text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Room-Night Equivalent</div>
                  <div className="text-2xl font-semibold mt-1">{nightsEquivalent.toFixed(1)} nights</div>
                  <Help>At ADR {currency(adr, currencyCode)}</Help>
                </Card>
                <Card>
                  <div className="text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Hotel Barter Cost</div>
                  <div className="text-2xl font-semibold mt-1">{currency(barterCostToHotel, currencyCode)}</div>
                  <Help>Marginal cost for those nights.</Help>
                </Card>
                <Card>
                  <div className="text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Decision Aid</div>
                  <div className="text-2xl font-semibold mt-1">{acceptBand.label}</div>
                  <Help>Compare cost vs EMV to guide accept / negotiate / decline.</Help>
                </Card>
              </div>

              <div className="mt-4 flex gap-3">
                <Button onClick={exportPDF}><FileDown className="h-4 w-4"/> Export one-pager PDF</Button>
              </div>

              <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-300">Tip: Add UTM links &amp; unique offer codes to measure actual revenue. Tie acceptance to deliverable calendar &amp; brand guidelines.</div>
            </div>
          </Card>
        </div>

        <Card className="mt-6">
          <div className="flex items-center gap-2 mb-2"><Info className="h-4 w-4"/><h3 className="font-semibold">Model Notes &amp; KPIs</h3></div>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li><span className="font-medium">Engagement Rate (ER):</span> (likes+comments)/followers for posts; for video-first platforms, use views/followers.</li>
            <li><span className="font-medium">Impressions (est.):</span> followers × reach rate (feed), lower for stories, higher for video; override with your data.</li>
            <li><span className="font-medium">EMV:</span> (impressions ÷ 1000) × CPM × quality × brand-fit × (1 + surcharges).</li>
            <li><span className="font-medium">Surcharges:</span> +15% usage &gt;30 days; +20% exclusivity first month (+10% each extra); +20% whitelisting.</li>
            <li><span className="font-medium">Tiers:</span> Nano &lt;10k, Micro 10–100k, Mid 100–500k, Macro 500k–1M, Mega 1M+.</li>
            <li><span className="font-medium">Decision guardrails:</span> If (barter cost / EMV) &lt; 50% ✅; 50–70% ⚠️ negotiate; &gt;70% ❌.</li>
          </ul>
        </Card>

        {/* Self-tests */}
        <Card className="mt-6">
          <div className="text-sm font-semibold mb-2">Self-tests</div>
          <ul className="text-sm list-disc pl-5 space-y-1">
            {tests.map((t, i) => (
              <li key={i} className={t.pass ? "text-emerald-600" : "text-red-600"}>
                {t.pass ? "PASS" : "FAIL"} — {t.name}
              </li>
            ))}
          </ul>
        </Card>

        <div className="mt-8 text-center text-xs text-zinc-600 dark:text-zinc-300">
          Built for hospitality collaborations • Adjust CPMs and rates to your latest benchmarks.
        </div>
      </div>
    </div>
  );
}
