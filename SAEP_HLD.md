# Synthetic Audience Evaluation Platform (SAEP)
## High-Level Design (HLD)

## 1. Objective

### Problem Statement
Modern brand pages and campaigns are optimized primarily through live traffic experiments (A/B tests). This approach suffers from several critical bottlenecks:
*   **Slow & Expensive:** Requires significant traffic to reach statistical significance.
*   **Customer Exposure:** Exposes real users to suboptimal, unproven experiences.
*   **Long-Tail Blindspots:** Cannot efficiently test rare personas, niche intents, or localized SEO variations.
*   **Lack of Pre-Validation:** There is no scalable pre-production system to evaluate SEO coverage, persona-intent alignment, and user journey friction.

### Goals
SAEP aims to build a calibrated, cost-efficient simulation platform that accelerates hypothesis validation and reduces experimentation cost by:
1.  **SEO Pre-Validation:** Simulating query generation to evaluate intent-to-page mapping and identifying coverage gaps.
2.  **Campaign Pre-Launch Testing:** Simulating persona interaction with landing pages to score message-intent alignment and predict bounce risk.
3.  **Journey Friction Detection:** Highlighting navigation dead-ends, drop-off patterns, and weak conversion steps across simulated flows.


## 2. Proposed Solution

The platform's core proposition is shifting experimentation *left* by leveraging **Synthetic Audiences**.

### What are Synthetic Audiences?
Synthetic audiences are AI-generated, virtual consumer profiles created using generative AI trained on real data (social media, surveys, reviews) to simulate human reactions. They enable marketers and researchers to rapidly test, validate, and refine concepts, campaigns, or products, delivering insights in hours rather than weeks.

*   **Capabilities:** Simulating focus groups, testing ad creative, and exploring market segments.
*   **Accuracy:** Built on demographic, psychographic, and behavioral vectors to provide relevant responses.
*   **Benefits:** High speed, massive scalability, and risk-free testing of sensitive demographics.

### SAEP Platform Concept
The **Synthetic Audience Evaluation Platform (SAEP)** operationalizes these synthetic audiences via a fleet of headless browser agents. By deploying LLM-driven behavioral models onto target web properties, SAEP detects content gaps, layout friction, and intent-mismatches *before* live deployment.

**Core Differentiators (Our IP):**
1.  **Stochastic Intent Engine:** Not static personas, but probabilistic distributions of intent that evolve as the synthetic user navigates.
2.  **Cost-Aware Emulation:** Dynamically shifting between lightweight DOM-parsing and full headless browser emulation.
3.  **Friction Graph Analysis:** ML-based detection of "cognitive load" and UX dead-ends mapped onto a DOM tree.


## 3. Architecture and Design

### 3.1 Agentic Architecture Overview
The platform is built on an **Agentic Architecture** utilizing a Multi-Agent System (MAS) pattern. Rather than rigid microservices, the system employs specialized, autonomous LLM agents that collaborate to execute the simulation lifecycle. Each agent has a distinct role, its own tools, and a shared memory layer.

![SAEP Architecture](./diagrams/saep_architecture.png)

### 3.2 End-to-End Simulation Lifecycle

```
Marketer                    Orchestrator    PersonaGen    Intent Engine    Manager    Workers    Evaluators
   |                             |              |              |             |          |            |
   |-- Submit URL + segment ---->|              |              |             |          |            |
   |                             |-- Generate ->|              |             |          |            |
   |                             |              |-- Personas ->|             |          |            |
   |                             |              |              |-- Queries ->|          |            |
   |                             |              |              |             |          |            |
   |                             |              |              |             |-- Spawn->|            |
   |                             |              |              |             |          |            |
   |                             |              |              |             |    [Loop per Agent]   |
   |                             |              |              |             |    Load page          |
   |                             |              |              |             |    Observe viewport   |
   |                             |              |              |             |    Decide action      |
   |                             |              |              |             |    Execute action     |
   |                             |              |              |             |<-Telemetry|           |
   |                             |              |              |             |    [End Loop]         |
   |                             |              |              |             |          |            |
   |                             |<------------ Complete ------|             |          |            |
   |                             |-- Analyze -------------------------------------------------->|    |
   |                             |              |              |             |          |  Compute   |
   |                             |<---------------------------------------- Insights --|-------------|
   |<---- Final Report ----------|              |              |             |          |            |
```

### 3.3 Core Agentic Subsystems

#### Orchestrator Agent (OA)
The central coordinator. Receives a high-level goal ("Evaluate this landing page for Gen-Z"), decomposes it into sub-tasks, delegates to specialized agents, and synthesizes the final report. This is the *only* agent the user-facing API communicates with.

#### Persona Generation Agent (PGA)
An autonomous agent responsible for generating OR retrieving high-fidelity synthetic users.
*   **Audience Library (Reuse):** The PGA first queries the Vector DB for existing audience cohorts. If a sufficiently similar cohort exists (cosine similarity > threshold), it reuses those personas directly, skipping the expensive LLM generation step.
*   **Fresh Generation:** When no suitable cohort exists, the PGA generates new personas via the Trait Matrix Engine — expanding seed keywords into multi-dimensional vectors (Demographics, Psychographics, Technical literacy, Device context).
*   **Versioned Memory:** Personas are persisted and versioned in a Vector DB. Teams can curate, tag, and share audience cohorts across campaigns.

#### Intent and Query Engine (IQE)
A dedicated engine that takes persona profiles and produces realistic search queries and intent distributions.
*   **Query Synthesis:** Employs RAG over real search data to generate long-tail queries each persona would realistically type.
*   **Intent Classification:** Tags each query with an intent type (Informational, Navigational, Transactional, Commercial) and confidence score.
*   **Output:** A structured query set with intent vectors that feeds into both the SERP Simulator (for SEO evaluation) and the Manager Agent (for browsing simulation).

#### SERP Simulator
Simulates search engine ranking behavior to evaluate query-to-page mapping *without* live traffic.
*   Takes the query set from the IQE and the target URL(s).
*   Computes a simulated ranking position based on content relevance, keyword coverage, and page authority signals.
*   Outputs a gap report: which personas' queries the target page would *not* rank well for.

#### Manager Agent
Responsible for execution planning and fleet management. Decides *how many* worker agents to spawn, *which tier* (DOM-only vs. full browser) to assign each persona to, and monitors for completion / timeouts.

#### Worker Agent Pool (WAP)
The "actors" of the system. Dynamically provisioned, stateless LLM agents that execute the actual browsing.
*   **Tier 1 (Lightweight / SEO):** Fast HTTP request agents for content extraction. Suitable for text-heavy, server-rendered pages.
*   **Tier 2 (Full Emulation / UX):** Distributed Playwright nodes for interactive page evaluation. **Required for graphics-heavy, JS-rendered, or SPA pages.**
*   **Tier 3 (Vision-Heavy):** Captures full-page screenshots and uses a Vision-Language Model (VLM) to interpret visual layout (hero banners, product carousels, video landing pages).
*   **Vision-Action Loop:** The agent observes the viewport, translates DOM/Visuals into its working memory, and selects its next tool (Scroll, Click, Extract, Bounce) based on its persona's intent state.

#### DOM Cache
A content-addressable cache layer that stores hashed DOM states and their corresponding evaluation results.
*   Before a Worker Agent invokes the LLM, it checks the cache for a matching page state.
*   On cache hit, the pre-computed heuristic is returned instantly — no LLM call, no browser session.
*   Dramatically reduces cost for repeat evaluations of unchanged pages.

#### Evaluation Agents (EA)
*   **SEO Evaluator:** Consumes SERP Simulator output + telemetry from ES. Computes cosine similarity between the persona's *intent vector* and the page's *content embedding*. Identifies IR gaps.
*   **UX Friction Evaluator:** Uses **Decision Perplexity** (LLM confidence in its next action) as a proxy for human frustration. Maps trajectories to predict drop-offs and navigation dead-ends.

#### Calibration Agent (CA)
A background agent that continuously improves the system's predictive accuracy.
*   Compares SAEP-predicted metrics (bounce rate, conversion, engagement) against *known* historical analytics from real pages.
*   Computes the delta and fine-tunes: persona generation parameters in PGA, intent transition probabilities in IQE, and scoring weights in the Evaluator Agents.
*   Target: Pearson correlation > 0.85 before the platform is used for unseen pages.

#### Report Store (RS)
Persists all evaluation results, simulation metadata, and compiled reports.
*   Enables historical comparison: "How did Campaign A perform vs. Campaign B?"
*   Feeds the Calibration Agent with ground-truth data for continuous tuning.
*   Serves as the data source for the dashboard UI.

### 3.4 Key Design Details

#### Intent Drifting Model
Human intent is not static. A user might start *Informational* and drift to *Transactional* based on what they read. SAEP models intent as a **Markov chain** with transition probabilities modified by the semantic payload of the current page. If the page delivers a trust signal, the worker agent's internal intent state shifts closer to conversion.

#### Calibration Loop
To ensure synthetic evaluations *correlate* with real user behavior, SAEP includes a calibration mechanism:
1.  Run SAEP simulations against pages with *known* historical analytics (real bounce rate, real conversion rate).
2.  Compare SAEP-predicted metrics vs. actual metrics.
3.  Use the delta to fine-tune persona generation parameters, intent transition probabilities, and friction scoring weights.
4.  Re-run. Target: Pearson correlation > 0.85 before the platform is used for *unseen* pages.

#### Shared Memory Layer
All agents share a centralized **Event Store (ClickHouse)** that acts as the system's collective memory. Worker agents write telemetry (DOM snapshots, click sequences, internal reasoning traces). Evaluator agents read from this store. This decouples execution from analysis and allows replaying simulations without re-running browser sessions.

#### Graphics-Heavy Page Strategy
Pages that rely heavily on images, animations, carousels, and video cannot be evaluated by DOM parsing alone. SAEP handles this via:
1.  **Auto-Detection:** The Manager Agent inspects the initial page load. If the DOM is sparse (< N meaningful text nodes) or JS bundle size exceeds a threshold, it auto-promotes the task to Tier 2 or Tier 3.
2.  **Screenshot Diffing:** Tier 3 agents capture viewport screenshots at each interaction step. A lightweight image-diff model detects whether the page *visually changed* after a click/scroll, catching JS-rendered state transitions invisible to DOM inspection.
3.  **Selective Vision:** Vision-Language Model calls are expensive. SAEP only invokes the VLM when the DOM-based agent signals uncertainty (low action-confidence). For pages where the DOM is descriptive enough (e.g., alt-text, aria-labels), it stays in cheap DOM mode even if the page is visually rich.

#### Cost Control Model
SAEP is designed for cost-effective operation at scale:
1.  **Budget Caps:** Each simulation run accepts a `max_budget` parameter. The Manager Agent distributes budget across workers and stops spawning agents when the cap is approached.
2.  **Persona Reuse:** Reusing existing audience cohorts from the Audience Library avoids the LLM cost of generating new personas (~$0.01-0.05 per persona).
3.  **Tiered Routing:** The Bandit algorithm ensures 90% of evaluations stay in Tier 1 (~$0.002/eval). Only genuinely interactive pages escalate to Tier 2/3.
4.  **DOM Cache:** If the same page state has been evaluated before (content hash match), the system returns the cached evaluation result without re-invoking any LLM.
5.  **Batch Scheduling:** Non-urgent evaluations can be queued for off-peak LLM API pricing windows.

#### Agent Guardrails and Termination Policies
Autonomous agents can enter infinite loops. SAEP treats this as both a **risk to manage** and a **signal to capture**.

**Worker Agent Loop Prevention:**
*   **Max Step Count:** Each worker is capped at N actions (default: 25). After exceeding this, the agent force-terminates with status `Incomplete`. The Orchestrator flags this to the evaluator as a potential UX friction signal.
*   **Cycle Detection:** Every action produces a DOM state hash. If the same hash appears 3 times in a session, the worker terminates with status `Loop Detected`. This is itself a high-value insight — it means a real user would likely get stuck in the same cycle.
*   **Token Budget Gate:** Each worker is allocated a fixed token budget by the Manager Agent. When exhausted, the worker terminates regardless of progress. This prevents runaway LLM costs from a single confused agent.
*   **Wall-Clock Timeout:** Hard timeout per worker session (default: 60s for Tier 2, 120s for Tier 3). Catches edge cases where the page itself hangs or loads indefinitely.

**Calibration Agent Convergence Control:**
*   **Epoch-Based Execution:** The CA runs in discrete calibration epochs, not continuously. After each epoch, it checks whether the delta between predicted and actual metrics decreased.
*   **Convergence Threshold:** If the delta improvement between consecutive epochs is < 0.01, the CA stops tuning and marks the current weights as stable.
*   **Learning Rate Decay:** Each successive epoch applies smaller weight adjustments (e.g., 0.1 → 0.05 → 0.025) to prevent oscillation.
*   **Max Epochs:** Hard cap of 10 calibration rounds. If convergence is not reached, the CA flags the dataset as insufficiently representative and alerts the operator.

**Intent Drift Termination:**
*   **Absorbing States:** "Bounced" and "Converted" are absorbing states in the Markov chain — once entered, the agent commits and the session ends. No backtracking.
*   **Max Session Depth:** After N page transitions (default: 10), the agent is forced to make a terminal decision (Bounce or Convert), preventing indefinite funnel exploration.


## 4. Trade-Offs and Design Decisions

### A. Emulation Fidelity vs. Operational Cost
| | Tier 1 (DOM-only) | Tier 2 (Full Browser) | Tier 3 (Vision-Heavy) |
|---|---|---|---|
| **Cost per eval** | ~$0.002 | ~$0.15 | ~$0.40 |
| **Latency** | < 1s | 10-30s | 30-60s |
| **Capability** | SEO, content gaps | Interactive UX flows | Visual-heavy layouts |
| **Usage share** | ~85% | ~10% | ~5% |

*   **Decision:** A Multi-Armed Bandit routes personas to the cheapest tier that can reliably evaluate the page. Pages are auto-classified by DOM density and JS payload size.

### B. Stateful vs. Stateless Worker Agents
*   **Decision:** Workers are stateless between interaction steps; session context is offloaded to the Event Store.
*   **Trade-off:** Persistent LLM state is resource-heavy at scale, but stripping state hurts the agent's ability to "remember" previous pages in a funnel.
*   **Resolution:** The Event Store rebuilds the necessary context window (recent DOM states, previous clicks) on-the-fly when prompting the LLM for the next action. This scales horizontally without sticky-session bottlenecks.

### C. LLM Selection: Intelligence vs. Latency
*   **Decision:** Model routing — fast models (Haiku-class) for Tier 1, vision models (Sonnet-class) for Tier 2.
*   **Trade-off:** Vision-language models introduce ~3-5s latency per interaction step, skewing simulated time-on-page.
*   **Resolution:** SAEP does *not* use wall-clock time as a UX metric. Instead, it uses **Decision Perplexity** (model's confidence in its next action) as the friction proxy. Low confidence = confusing UI, regardless of how long the LLM took to generate.

### D. Synthetic Accuracy vs. Real-World Validity
*   **Decision:** SAEP is positioned as a *directional pre-filter*, not a replacement for live experimentation.
*   **Trade-off:** Synthetic audiences will never perfectly replicate real human behavior.
*   **Resolution:** The Calibration Loop (Section 3.4) continuously adjusts model parameters against known ground-truth pages. SAEP's output is a *risk score with confidence intervals*, not a definitive prediction.

### E. Fresh Persona Generation vs. Audience Reuse
*   **Decision:** Default to reuse; generate only when no matching cohort exists.
*   **Trade-off:** Reused personas are cheaper and faster but may not perfectly match a new, nuanced segment. Fresh generation is more precise but adds ~$0.01-0.05 per persona in LLM cost and 2-5s latency.
*   **Resolution:** The PGA uses a similarity threshold on the Vector DB query. If match score > 0.90, it reuses. Between 0.75-0.90, it reuses but *augments* the persona with delta traits. Below 0.75, it generates fresh.

## 5. Success Metrics

| Metric | Target | How Measured |
|---|---|---|
| **Predictive Accuracy** | Pearson r > 0.85 | Correlation of SAEP bounce rate vs. historical analytics on calibration pages |
| **Time-to-Insight** | < 5 minutes | End-to-end for a 500-persona cohort simulation |
| **Cost per Evaluation** | < $5 per campaign | Blended cost across Tier 1 + Tier 2 agents |
| **SEO Gap Detection** | > 80% recall | Validated against manual SEO audit findings |
| **Cost Avoidance** | > 30% reduction | Reduction in live A/B test infrastructure spend |