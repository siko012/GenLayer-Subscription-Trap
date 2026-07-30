import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import * as d3 from "d3";
import {
  submitFlow, analyzeFlow, adjudicate, flagOrClear,
  getCase, getCounts, getPoolBalance, listAll,
  FlowCaseView, FlowRow,
} from "./contractService";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const STATUS_LABEL = ["filed", "analyzed", "ruled", "settled"];
const OBSTACLE_DARK_FLOOR = 4;
const PREFERS_REDUCED = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

function shortAddr(a: string): string {
  return a && a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a || "-";
}
async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); } catch { /* clipboard blocked */ }
}

// Offramp variant: obstacle count trend across audited flows. Threshold at 4 = DARK_PATTERN.
function ObstacleTrend({ rows }: { rows: FlowRow[] }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const ruled = useMemo(() => rows.filter((r) => r.verdict).slice().reverse(), [rows]);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = 720, H = 240;
    const PAD = { l: 38, r: 18, t: 12, b: 22 };
    const maxObs = Math.max(8, ...ruled.map((r) => r.obstacleCount));
    const xs = d3.scaleLinear().domain([0, Math.max(1, ruled.length - 1)]).range([PAD.l, W - PAD.r]);
    const ys = d3.scaleLinear().domain([0, maxObs]).range([H - PAD.b, PAD.t]);

    const g = svg.append("g").attr("class", "grid");
    [0, OBSTACLE_DARK_FLOOR, maxObs].forEach((v) => {
      g.append("line").attr("x1", PAD.l).attr("x2", W - PAD.r).attr("y1", ys(v)).attr("y2", ys(v))
        .attr("class", v === OBSTACLE_DARK_FLOOR ? "thr-dark" : "g");
      g.append("text").attr("x", 6).attr("y", ys(v)).attr("dy", "0.35em").attr("class", "gl").text(v.toString());
    });
    g.append("text").attr("x", W - PAD.r - 4).attr("y", ys(OBSTACLE_DARK_FLOOR) - 6).attr("class", "thrl").attr("text-anchor", "end").text("dark-pattern floor (>=4)");

    if (ruled.length === 0) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("class", "empty").attr("text-anchor", "middle").text("No flows audited yet - submit the first cancellation flow to begin the trend.");
      return;
    }

    const pts = ruled.map((r, i) => ({ x: xs(i), y: ys(r.obstacleCount), r }));
    // Step area: cancellation flows are step-by-step
    const a = d3.area<typeof pts[0]>().x((d) => d.x).y0(H - PAD.b).y1((d) => d.y).curve(d3.curveStepAfter);
    const lp = d3.line<typeof pts[0]>().x((d) => d.x).y((d) => d.y).curve(d3.curveStepAfter);
    svg.append("path").attr("d", a(pts) as string).attr("class", "ar-obs");
    const p = svg.append("path").attr("d", lp(pts) as string).attr("class", "ar-line");
    const len = (p.node() as SVGPathElement).getTotalLength();
    if (PREFERS_REDUCED) {
      p.attr("stroke-dashoffset", 0);
    } else {
      p.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
        .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
    }

    svg.append("g").selectAll("circle").data(pts).join("circle")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", 4)
      .attr("class", (d) => `dot v-${d.r.verdict}`);
  }, [ruled]);
  return <svg ref={ref} className="area" viewBox="0 0 720 240" preserveAspectRatio="xMidYMid meet" />;
}

function Spark({ values, danger = false }: { values: number[]; danger?: boolean }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (values.length === 0) return;
    const W = 88, H = 22;
    const xs = d3.scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([0, W]);
    const ys = d3.scaleLinear().domain([0, Math.max(1, d3.max(values) || 1)]).range([H - 1, 1]);
    svg.append("path").attr("d", d3.area<number>().x((_, i) => xs(i)).y0(H).y1((d) => ys(d)).curve(d3.curveStepAfter)(values) as string).attr("class", danger ? "sp-a-danger" : "sp-a");
    svg.append("path").attr("d", d3.line<number>().x((_, i) => xs(i)).y((d) => ys(d)).curve(d3.curveStepAfter)(values) as string).attr("class", danger ? "sp-l-danger" : "sp-l");
  }, [values, danger]);
  return <svg ref={ref} className="spark" viewBox="0 0 88 22" preserveAspectRatio="none" />;
}

// Parse a flow text into numbered steps (line breaks or numbered prefixes).
function parseFlow(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines : text.split(/(?<=\.)\s+/).filter(Boolean);
}

export function App() {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;

  const [service, setService] = useState("");
  const [flowText, setFlowText] = useState("");
  const [bond, setBond] = useState("1");
  const [rows, setRows] = useState<FlowRow[]>([]);
  const [counts, setCounts] = useState({ next: 0, ruled: 0, dark: 0 });
  const [pool, setPool] = useState("0");
  const [selId, setSelId] = useState<number | null>(null);
  const [sel, setSel] = useState<FlowCaseView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [netErr, setNetErr] = useState(false);

  async function refreshAll() {
    if (typeof document !== "undefined" && document.hidden) return; // pause when tab hidden
    try {
      const [c, p, list] = await Promise.all([getCounts(), getPoolBalance(), listAll(50)]);
      setCounts(c); setPool(p.split("||")[0] || "0"); setRows(list);
      if (selId != null) { try { setSel(await getCase(selId)); } catch { /* keep */ } }
      setNetErr(false);
    } catch { setNetErr(true); /* surfaced, not silent */ }
  }
  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 12000);
    const onVis = () => { if (!document.hidden) refreshAll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  async function pick(id: number) {
    setSelId(id);
    try { setSel(await getCase(id)); } catch { setSel(null); }
  }
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setNote("");
    try { return await fn(); } catch (e) { setNote(String((e as Error).message || e).slice(0, 220)); return undefined; }
    finally { setBusy(null); refreshAll(); }
  }

  async function onSubmit() {
    if (!acct) return;
    if (service.trim().length < 2) return setNote("Service name is required.");
    if (flowText.trim().length < 25) return setNote("Paste at least 25 chars of the cancellation flow.");
    const id = await run("Submitting the cancellation flow", () => submitFlow(acct, { service, flowText, bondWei: BigInt(Math.max(1, Math.floor(Number(bond) || 1))) }));
    if (id != null) { setSelId(id); setNote(`Flow #${id} filed. Run analysis to count obstacles.`); }
  }
  async function onAnalyze() { if (!acct || selId == null) return; await run("Analyzing the flow", () => analyzeFlow(acct, selId)); }
  async function onAdjudicate() { if (!acct || selId == null) return; await run("Validators ruling the pattern", () => adjudicate(acct, selId)); }
  async function onFlagOrClear() { if (!acct || selId == null) return; await run("Settling the flow", () => flagOrClear(acct, selId)); }

  const sparkRuled = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.verdict ? 1 : 0)); }, [rows]);
  const sparkDark = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.verdict === "DARK_PATTERN" ? 1 : 0)); }, [rows]);
  const sparkObsAvg = useMemo(() => {
    const ruled = rows.filter((r) => r.verdict).slice().reverse();
    let sum = 0;
    return ruled.map((r, i) => { sum += r.obstacleCount; return Math.round(sum / (i + 1)); });
  }, [rows]);
  const sparkSettled = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.status === 3 ? 1 : 0)); }, [rows]);

  const flowSteps = sel ? parseFlow(sel.flowText) : [];

  return (
    <div className="page">
      <header className="bar">
        <div className="brand">
          <span className="wm">Offramp</span>
          <em className="tag">cancellation flow audit</em>
        </div>
        <div className="bar-r">
          <span className="chip"><i className="dot" /> GenLayer · studionet · {netErr ? "reconnecting…" : "live"}</span>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
        </div>
      </header>

      <section className="hero">
        <div className="hcopy">
          <p className="kicker">Offramp · cancellation flow audit</p>
          <h1>Leaving should be<br />as easy as joining.</h1>
          <p className="lede">
            Paste the cancellation flow you walked through. A panel of GenLayer validators counts every{" "}
            <em>obstacle deliberately placed</em> between you and the unsubscribe button - hidden links,
            forced phone calls, retention loops. Four or more flips the verdict to DARK_PATTERN.
          </p>
          <div className="meta">
            <span>contract</span><button type="button" className="copybtn" aria-label="Copier l'adresse du contrat" onClick={() => copyText(CONTRACT_ADDRESS)}><code>{shortAddr(CONTRACT_ADDRESS)}</code> ⧉</button>
            <span className="sep">·</span>
            <span>verdicts</span><code>CLEAN · GREY · DARK_PATTERN</code>
          </div>
          <p className="prov">Source : flux d'annulation soumis on-chain - jugé par les validateurs GenLayer via <code>gl.nondet</code>.</p>
        </div>
        <div className="hviz">
          <div className="hviz-h">
            <span>Obstacle count by audited flow</span>
            <span className="muted">step-by-step trend, dark floor at 4</span>
          </div>
          <ObstacleTrend rows={rows} />
        </div>
      </section>

      <section className="stats">
        <div className="stat"><span className="lbl">Flows submitted</span><span className="num">{counts.next}</span><Spark values={Array.from({ length: counts.next + 1 }, (_, i) => i)} /></div>
        <div className="stat"><span className="lbl">Adjudicated</span><span className="num">{counts.ruled}</span><Spark values={sparkRuled} /></div>
        <div className="stat"><span className="lbl">Dark patterns</span><span className="num">{counts.dark}</span><Spark values={sparkDark} danger /></div>
        <div className="stat"><span className="lbl">Avg obstacles</span><span className="num">{sparkObsAvg.length ? sparkObsAvg[sparkObsAvg.length - 1] : 0}</span><Spark values={sparkObsAvg} /></div>
        <div className="stat"><span className="lbl">Settled · pool</span><span className="num">{pool}</span><Spark values={sparkSettled} /></div>
      </section>

      <nav className="rule">
        <span><i>1</i> Submit the cancellation flow</span>
        <span><i>2</i> Analyze the obstacles</span>
        <span><i>3</i> Validators rule the pattern</span>
        <span><i>4</i> Flag or clear · settle bond</span>
      </nav>

      <section className="work">
        <div className="ledger">
          <div className="ledger-h">
            <h2>Flow ledger</h2>
            <span className="muted">{rows.length} on-chain · audited cancellation funnels</span>
          </div>
          {rows.length === 0 ? (<p className="empty-row">No flows yet. Submit the first one.</p>) : (
            <table className="tbl">
              <thead><tr><th>flow</th><th>status</th><th>obstacles</th><th>verdict</th><th>service &amp; reporter</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`${selId === r.id ? "sel" : ""} ${r.verdict === "DARK_PATTERN" ? "dark" : ""}`} onClick={() => pick(r.id)} tabIndex={0} role="button" aria-label={`Flow ${r.id}, ${r.service || "service"}, ${r.verdict || "pending"}`} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(r.id); } }}>
                    <td><code>#{r.id}</code></td>
                    <td><span className={`pill s${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                    <td className="bar-cell">
                      <div className="fb"><i style={{ width: `${Math.min(100, (r.obstacleCount / 8) * 100)}%` }} className={r.verdict === "DARK_PATTERN" ? "fill-bad" : r.verdict === "GREY" ? "fill-mid" : "fill-good"} /></div>
                      <code className="bv">{r.obstacleCount} step{r.obstacleCount === 1 ? "" : "s"}</code>
                    </td>
                    <td><span className={`vd v-${r.verdict || "none"}`}>{r.verdict || "pending"}</span></td>
                    <td>
                      <code className="zone">{r.service || "-"}</code>
                      <span className="vs">·</span>
                      <code className="addr">{shortAddr(r.reporter)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Submit a flow</h3>
            <label>Service name</label>
            <input value={service} onChange={(e) => setService(e.target.value)} placeholder="e.g. SaaS-Inc, gym chain, ISP..." />
            <label>Cancellation flow (one step per line)</label>
            <textarea value={flowText} onChange={(e) => setFlowText(e.target.value)} placeholder={"1. Open account settings\n2. Find Cancel link, hidden under 'Manage'\n3. Click Cancel, get redirected to retention page\n4. ..."} />
            <label>Bond (wei)</label>
            <input value={bond} onChange={(e) => setBond(e.target.value)} placeholder="1" />
            <button className="go" disabled={!isConnected || !!busy || service.trim().length < 2 || flowText.trim().length < 25} onClick={onSubmit}>
              {isConnected ? "Post bond & submit flow" : "Connect a wallet to submit"}
            </button>
          </div>

          {sel && selId != null && (
            <div className="panel selpanel">
              <h3>Selected · flow <code>#{selId}</code></h3>
              <div className="kv"><span>service</span><code>{sel.service}</code></div>
              <div className="kv"><span>status</span><b>{STATUS_LABEL[sel.status] || sel.status}</b></div>
              <div className="kv"><span>bond</span><code>{sel.bond}</code></div>
              {sel.verdict ? (
                <>
                  <div className={`verdict v-${sel.verdict}`}>{sel.verdict.replace("_", " ")}</div>
                  <div className="kv"><span>obstacles</span><code>{sel.obstacleCount}</code></div>
                  {sel.rationale && <p className="rationale">{sel.rationale}</p>}
                </>
              ) : (<p className="muted">Awaiting analysis.</p>)}

              <h4 className="step-h">The audited flow</h4>
              {flowSteps.length === 0 ? (
                <p className="muted">No flow steps recorded.</p>
              ) : (
                <ol className="step-list">
                  {flowSteps.map((s, i) => (
                    <li key={i}>
                      <span className="step-n">{i + 1}</span>
                      <span className="step-t">{s}</span>
                    </li>
                  ))}
                </ol>
              )}

              {sel.status === 0 && (<button className="go" disabled={!isConnected || !!busy} onClick={onAnalyze}>Analyze obstacles</button>)}
              {sel.status === 1 && (<button className="go" disabled={!isConnected || !!busy} onClick={onAdjudicate}>Rule the pattern</button>)}
              {sel.status === 2 && (<button className="go" disabled={!isConnected || !!busy} onClick={onFlagOrClear}>Flag or clear · settle bond</button>)}
              {sel.status === 3 && (<p className="muted">Settled.</p>)}
            </div>
          )}
        </aside>
      </section>

      {(busy || note) && <div className="toast">{busy ? `${busy}...` : note}</div>}

      <footer className="foot">
        <span>contract <code>{shortAddr(CONTRACT_ADDRESS)}</code></span>
        <span>fee pool {pool}</span>
        <span>cancellation verdicts reproduced by independent GenLayer validators on studionet</span>
      </footer>
    </div>
  );
}
