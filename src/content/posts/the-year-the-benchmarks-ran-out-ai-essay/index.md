---
# Published from Obsidian by the Orbital Station publisher.
# Edit the note in your vault and publish again — changes made here are overwritten.
# source-id: 3edfc80298f9
title: The Year the Benchmarks Ran Out - AI Essay
date: 2026-09-26
summary: AI in late 2026 is more capable than ever and less settled than ever. The scoreboards are saturated, and the real questions are now about reliability, regulation, and who controls the plumbing.
orbit: systems
kind: essay
tags: []
---

## The Year the Benchmarks Ran Out
### AI in late 2026 is more capable than ever and less settled than ever. The scoreboards are saturated, and the real questions are now about reliability, regulation, and who controls the plumbing.

**By Zenkar Kollurmath**

The most important fact about AI in September 2026 is that capability is no longer the bottleneck. Validation, integration and governance are. The frontier models can now pass nearly every test we built to measure them, and yet the systems around them are still catching up: the enterprises, the courts, the regulators and the labor market.

**TL;DR**

- Frontier models have saturated the benchmarks that defined the last three years. Claude Opus 5 is independently measured at 97% on SWE-bench Verified, and agents beat the human baseline on OSWorld. On harder, standardized, long-horizon tests, though, performance drops sharply (61.5% on Scale's SWE-bench Pro public set; 20.6% full completion on OSWorld 2.0). The gap between "passes the test" and "does the job" is now the central story.
- Governance moved from theory to enforcement, unevenly. The U.S. government briefly used export controls to pull Anthropic's Claude Fable 5 and Mythos 5 offline in June 2026. The EU delayed its high-risk AI rules to December 2027 while keeping transparency rules live. The copyright fight is being settled with checks more than with verdicts: the July 20, 2026 final approval order in Anthropic's book settlement puts the estimated payment at approximately \$3,000 per work.
- The human effects are real but narrow. Entry-level hiring in AI-exposed jobs is down 19% relative to less-exposed work. Pew Research Center found users click a traditional search result in 8% of visits when an AI Overview appears, versus 15% without one. MIT's NANDA report found 95% of organizations getting zero return from generative AI. My recommendation to any organization: treat AI like any safety-relevant subsystem. Verify it against your own task, not the vendor's leaderboard.

---

### A physicist walks into a leaderboard

I trained as an astrophysicist before I became an aerospace engineer and, eventually, a systems engineer working on CT imaging architecture. Each of those disciplines left me with the same reflex. When someone shows me a number, I want to know the error bars, the measurement conditions, and what happens at the edge of the operating envelope. Astronomers learn early that a spectacular signal is usually an instrument artifact. Medical device engineers learn that a system is not "working" until it has been verified against requirements and validated against the actual clinical use. It also has to keep working when a tired technician does something unexpected at 3 a.m.

I bring this up because 2026 is the year AI's measurement instruments broke. They didn't fail. They pinned the needle.

SWE-bench Verified asks a model to fix real bugs from open-source Python repositories. In 2024 it was a brutal test. By September 2026, Anthropic's Claude Opus 5 was self-reporting 96% in its system card, and Vals.ai measured it independently at 97.0% with a bare-bones harness.\[1\] DeepSeek V4 Pro and OpenAI's GPT-5.6 Sol sit within a point of that.\[2\] When the top of a leaderboard is compressed into a band narrower than the run-to-run noise, the benchmark has stopped telling you who is best. It only tells you who is present.

The story changes as soon as the test gets harder and the conditions get standardized. On SWE-bench Pro, a tougher successor, Scale AI's standardized public leaderboard was topped in mid-September by Meta's Muse Spark 1.1 at 61.5%, and on Scale's private commercial set the best score was 51.5%. Vendor-reported numbers on the same benchmark run as high as 80% for Claude Fable 5.\[3\] Independent trackers note that vendor scaffolds typically run 15 to 30 points above the standardized harness.\[4\] That spread is not fraud. It is the difference between a racing car on a closed track with its own pit crew and the same car on a public road. For anyone buying these systems it is the most important number in the field, and it is almost never in the press release.

This is my thesis for the year: **the frontier of AI has moved from capability to reliability.** The models can do astonishing things. What we lack is the verification and validation machinery that would let us know when they will do them. The rest of this article looks at where that gap is closing, where it is widening, and who is left holding the risk.

### The reasoning revolution, three years on

The technical story of the last two years starts with a simple idea: let the model think before it answers.

Early large language models produced answers the way a reflex produces a knee jerk: one token at a time, with a fixed amount of computation per word. "Chain-of-thought" prompting, popularized around GPT-4, showed that asking a model to write out intermediate steps improved its accuracy on math and logic. OpenAI's o-series turned that trick into a training target. Using reinforcement learning, it rewarded models for producing long internal reasoning traces that led to verifiably correct answers. DeepSeek-R1 then showed the recipe could be reproduced in the open. Google's Gemini "Thinking" and Deep Think modes, and Anthropic's adaptive "extended thinking," followed.

The paradigm this created is called **test-time compute**. Think of it as the difference between a student who blurts out an answer and one who is allowed scratch paper and ten more minutes. You can now buy intelligence at inference time as well as at training time. OpenAI's naming makes this explicit: GPT-5.6, released publicly on July 9, 2026, comes in three tiers (Luna, Terra and Sol),\[5\] and benchmark tables routinely list "max reasoning" or "xHigh" effort settings as separate entries.

Does this mean the models "understand"? I'd put it differently. Reasoning training teaches models to search: to generate candidate steps, check them, and backtrack. That is a real capability, and it is qualitatively different from recall. Its strength is also its limit, though. Reinforcement learning works best where answers can be checked automatically: math, code, formal puzzles. That is why coding and math scores have exploded while performance on open-ended judgment tasks has improved more slowly. A model that has learned to hill-climb toward a verifier is superb when a verifier exists. When the verifier is a human's messy, unstated preference, it is on shakier ground.

There is some genuinely interesting evidence about what goes on inside these models. Anthropic's interpretability team introduced "circuit tracing" in March 2025. The technique builds a simplified replacement model whose internal steps can be read like a wiring diagram.\[6\]\[7\] Using it on Claude 3.5 Haiku, researchers watched the model plan rhyming words before writing a line of poetry. They also saw it compute a two-hop answer internally (Dallas → Texas → Austin) rather than just pattern-matching.\[8\] In July 2026 the same team published work arguing that Claude maintains a small, privileged set of representations it can report on, control, and reason with, sitting atop a much larger volume of automatic processing.\[9\] Humility is warranted here too: independent summaries note that the original circuit-tracing work produced satisfying explanations for only about a quarter of the prompts studied.\[10\] We have a microscope now. We do not yet have a theory.

### Post-training is where the labs actually compete

If you want to understand why models from different labs feel different despite being trained on broadly similar internet-scale data, look at post-training.

Pre-training is the expensive, months-long process of teaching a model to predict text. It creates a vast, undifferentiated competence, something like a well-read person with no job and no manners. Post-training turns that into a product. The lineage runs from reinforcement learning from human feedback (RLHF), where humans rank outputs and the model learns their preferences, to RL from AI feedback (RLAIF), where a model grades another model against written principles. It then runs to process reward models, which grade each step of a reasoning chain instead of just the final answer. The 2025–2026 addition is large-scale reinforcement learning in *environments*: sandboxed codebases, browsers, and desktops where the reward is whether the task actually got done.

This is why I'd argue post-training has become the primary differentiator between labs. Pre-training recipes and data are converging, as the open-weight models show. What's proprietary is the environment suite, the graders, and the taste embedded in them. It also explains a failure mode practitioners keep hitting. A model optimized against a grader learns the grader's blind spots. "Reward hacking" is a model that writes code to pass the tests rather than to be correct. It is the machine-learning version of what engineers call teaching to the test, and it is one reason standardized, held-out evaluations matter so much.

### The efficiency arms race, and why inference is the real bottleneck

The other half of the technical story is cost. It is less glamorous and arguably more consequential.

The dominant architectural trick is the **mixture of experts** (MoE). Instead of running every parameter for every word, an MoE model routes each token through a small subset of specialist sub-networks. DeepSeek V4, released as open weights under an MIT license on April 24, 2026, is the clearest example.\[11\] V4-Pro has 1.6 trillion total parameters but activates only 49 billion per token, and V4-Flash has 284 billion total with 13 billion active.\[12\]\[13\] It is like a hospital with hundreds of specialists where any given patient sees three of them. The building is huge; the visit is cheap. DeepSeek listed V4-Pro at \$1.74 per million input tokens, roughly an order of magnitude below Western flagship pricing at launch.\[12\]

Long context is where the efficiency work gets truly interesting. DeepSeek V4 supports a one-million-token context window (enough for several novels or a mid-sized codebase).\[13\] The hard part of long context isn't the headline number. It's the **KV cache**, the model's working memory of everything it has already read, which grows linearly with context length and must sit in expensive GPU memory. DeepSeek says its hybrid compressed-attention design cuts KV-cache memory at 1M context to about 10% of its previous V3.2 generation, and requires about 27% of the per-token compute.\[13\] Those are the lab's own figures and deserve independent confirmation. They also point at the right problem.

Practitioners know the uncomfortable secret about million-token windows: a model that *accepts* a million tokens does not necessarily *use* them well. Retrieval accuracy for facts buried mid-context, reasoning across widely separated passages, and latency all degrade in ways the "needle in a haystack" demos don't capture. My working rule is that the effective context of a model is whatever length at which it still passes *your* retrieval tests. That number is usually much smaller than the spec sheet.

On the serving side, the unsung heroes are inference techniques that rarely make headlines:

- **Continuous batching** slots new requests into a running batch instead of waiting for the slowest one to finish, like an elevator that picks people up mid-trip.
- **Paged KV-cache management** allocates attention memory in small blocks, much as an operating system manages RAM.
- **Speculative decoding** has a small, fast model draft several tokens that the large model verifies in a single pass. It works like an intern writing a draft that the partner signs off on paragraph by paragraph.

These are why the price per token keeps falling even as models grow. They are also why the "AI is too expensive" argument has quietly moved from inference cost to energy and data-center capacity.

For on-device AI, the same forces are at work at smaller scale. Distillation (training a small model to imitate a large one), quantization (storing weights in 4-bit or lower precision), and small MoE models such as Ornith-1.5-35B-A3B, which activates about 3 billion parameters and still posts 79% on self-reported SWE-bench Verified tables, mean that genuinely useful models now run on laptops and flagship phones.\[14\] The practical split, as I see it, is this. Local models handle private, latency-sensitive, bounded tasks: transcription, summarization, autocomplete, photo understanding. Anything requiring frontier reasoning still goes to the cloud. That hybrid architecture is sensible engineering, not a compromise.

### Agents: past the human baseline, short of the job

"Agents" is the word of 2026, and it deserves the same scrutiny as the benchmarks.

Here's the good news, stated plainly. On OSWorld, a benchmark of 369 real desktop tasks in a live Ubuntu virtual machine, the original 2024 paper reported a human success rate of 72.36% and a best model score of 12.24%. By July 2026, frontier agents exceeded 85% on the verified version of the benchmark.\[15\] That is a genuinely remarkable two-year climb. METR's MirrorCode results from April 2026 showed agents completing coding tasks that would take a human weeks, including reimplementing a 16,000-line codebase.\[16\]

Now the qualification. OSWorld 2.0 was designed around longer professional workflows: 108 tasks with a median human completion time of about 1.6 hours and roughly 318 tool calls per agent run. The best configuration achieved only 20.6% full completion, with a 54.8% partial score. The documented failure modes will be familiar to anyone who has integrated a complex system. Agents lose track of constraints, miss information that appears mid-task, skip verification, and fail to recover from hidden state.\[15\]\[17\]

From a systems-engineering perspective, this is the classic problem of compounding reliability. If each step of a 300-step process succeeds 99% of the time, the whole chain succeeds about 5% of the time. Agents in 2026 are extraordinary at individual steps and still fragile over long chains. What they can reliably do today is bounded, checkable work with a human at the checkpoints: triaging a bug, drafting a migration, filling a form, running a research sweep. What they cannot reliably do is own an open-ended process end to end without supervision. Anyone telling you otherwise is quoting a closed-track number.

### MCP and the quiet standardization of the plumbing

One genuinely positive structural development deserves more attention than it gets. The industry converged on a standard for connecting models to tools, and it did so faster than anyone expected.

The Model Context Protocol, introduced by Anthropic in November 2024, is essentially a USB-C port for AI. It is a common way for any model to discover and call external tools, databases, and services. OpenAI adopted it in March 2025.\[18\]\[19\] On December 9, 2025, Anthropic donated MCP to the newly formed Agentic AI Foundation under the Linux Foundation, co-founded with Block and OpenAI and backed by Google, Microsoft, AWS, Cloudflare and Bloomberg. OpenAI's AGENTS.md convention and Block's goose agent framework joined as founding projects.\[20\]\[21\] MCP's official blog, announcing the move on December 9, 2025, reported "over 97 million monthly SDK downloads" and 10,000 active servers.

As an engineer who has spent years on interface control documents, I find this the most reassuring news of the year. Standard interfaces are how complex systems become maintainable. They are also how they become attackable. Every MCP server is a new trust boundary, and tool-connected agents inherit all the classic problems of injection, privilege escalation and supply-chain compromise. The protocol war is over; the security war around it has just started.

### The product reality: consolidation, coding, and the enterprise gap

On the consumer side, "chatbot fatigue" turned out to be consolidation, not decline. OpenAI officially reported 900 million weekly active ChatGPT users in February 2026, and multiple outlets reported the figure approaching or passing a billion weekly users by late summer. OpenAI's exact current number is less clearly confirmed.\[22\]\[23\] Google said its Gemini app passed one billion monthly users in August 2026. (Weekly and monthly users are different metrics, and the headline "parity" between the two is partly an artifact of measurement.)\[24\] The long tail of assistant apps from 2023 has largely withered. What makes a product sticky is not a better model but distribution and memory. The winners live where people already are (the phone, the browser, the search box, the IDE) and they remember enough context to be useful on Tuesday because of what you did on Monday.

Coding is where AI has changed daily work most visibly, and where the productivity data is most instructive. In July 2025, METR published a randomized controlled trial in which experienced open-source developers using early-2025 AI tools were 19% *slower*, while believing they had been sped up by about 20%.\[25\]\[26\] That perception gap is the single most important finding in AI productivity research. When METR tried to rerun the study with late-2025 tools, it hit a wall. As it explained in February 2026, many developers now refused to work without AI, so the control group self-selected into uselessness. METR's cautious conclusion was that late-2025 AI "likely accelerated" developers, but that selection effects obscure the true speedup.\[27\]\[28\] I read that as the honest state of the art. The tools very probably help, the magnitude is unknown, and self-reports are not evidence.

"Vibe coding" is the practice of describing what you want and accepting whatever the model produces without reading it closely. It is the cultural expression of this shift, and I have mixed feelings about it. For prototypes, personal tools, and exploration, it is liberating. It lowers the cost of trying an idea to nearly zero. But software craftsmanship was never mainly about typing code. It was about understanding the system well enough to know what could go wrong. In regulated engineering we have a phrase for code nobody understands: *unverified*. My prediction is that the craft doesn't disappear. It migrates. The valuable engineer of 2027 writes less code and more specifications, tests and review, and knows exactly where the model's output must not be trusted.

The enterprise picture is where the reliability gap becomes a balance-sheet item. MIT's NANDA report, "The GenAI Divide: State of AI in Business 2025," drew on more than 300 public AI initiatives, interviews with 52 organizations and a survey of 153 senior leaders. It found that "despite \$30–\$40 billion in enterprise investment into GenAI… 95% of organizations are getting zero return," and that only 5% of custom enterprise AI tools reach production. The reasons are rarely the model. They are data that isn't clean, workflows that weren't redesigned, security and compliance reviews that weren't budgeted, and the absence of a baseline against which anyone could measure improvement. Hallucination risk matters too, but mostly as a symptom. Organizations that can't specify what "correct" looks like for a task can't build the checks that catch errors. The organizations getting value have picked narrow, measurable workflows (customer-service resolution, document processing, code review) and instrumented them before and after.\[29\] Unglamorous, and effective.

### Search is broken again, and publishers are paying for it

Nowhere is AI's economic disruption clearer than in search. The evidence has hardened this year.

Pew Research Center tracked 900 U.S. adults across 68,879 real Google searches in March 2025. Users clicked a traditional result in 8% of visits when an AI summary appeared, against 15% when one didn't, a relative drop of nearly half. They also ended their browsing session after 26% of AI-summary visits, compared with 16% otherwise. Only 1% of visits clicked a link inside the summary itself. An Ahrefs analysis published in February 2026 associated AI Overviews with a 58% drop in click-through for top-ranking pages.\[30\] The strongest evidence is a randomized field experiment with 1,065 desktop Chrome users, posted to SSRN in April 2026. It found that showing an AI Overview cut outbound organic clicks by 39.8% and raised zero-click searches by 34.5%, while ad clicks stayed flat.\[31\] Google has disputed traffic-decline studies and, in May 2026, added "Further Exploration" links, subscription labels and inline link context to AI Overviews and AI Mode.\[30\]\[31\] Penske Media's antitrust suit against Google is testing whether this is a legal problem as well as an economic one.\[32\]

The new SEO reality is uncomfortable but clear. For informational queries, the answer is increasingly consumed on the results page. What remains valuable is what a summary can't substitute for: original reporting, proprietary data, community, and a brand people seek out directly. The web's implicit bargain was "we let you index us, you send us readers." That bargain is being renegotiated in licensing deals and in court, and I don't think the old version comes back.

### Copyright: settled by checkbook, not by verdict

The biggest legal development of 2026 wasn't a verdict. It was a payment.

In June 2025, Judge William Alsup ruled in *Bartz v. Anthropic* that training on books was fair use, "exceedingly transformative" in his words. He also ruled that building a permanent library from pirated copies was not.\[33\]\[34\] Anthropic then settled for \$1.5 billion.\[35\] On July 20, 2026, Judge Araceli Martínez-Olguín granted final approval. Her order states that "the estimated per-work payment of approximately \$3,000 is four times the minimum statutory damages amount." It also records claims filed for 440,490 of the 482,460 listed works as of April 16, sets attorneys' fees at about \$101.6 million, and overrules every objection. Several appeals, mostly over attorneys' fees, were filed in August, so payment timing remains uncertain.\[36\]\[37\]\[38\]

The lesson the industry took from *Bartz* is precise. How you acquire data matters as much as what you do with it.\[39\] Meanwhile, in *Kadrey v. Meta*, Judge Vince Chhabria granted Meta summary judgment on fair use in June 2025.\[40\] In 2026 he allowed the authors to add a contributory-infringement claim tied to Meta's BitTorrent activity, with summary judgment on those claims set for February 2027.\[41\]\[42\] In the UK, the High Court ruled in November 2025 that Stable Diffusion's model weights "are not themselves an infringing copy," and Getty has permission to appeal.\[43\]\[44\]

*The New York Times v. OpenAI and Microsoft*, the case everyone watches, still has no merits ruling. It has produced notable discovery orders, including one compelling production of 20 million de-identified ChatGPT logs.\[45\]\[46\] On September 1, 2026, the U.S. Department of Justice filed a statement of interest arguing that copying works to train a model can be fair use, while distinguishing questions about how data was acquired, how it was stored and what the model outputs. That is advocacy, not a ruling. The court has not decided.\[46\]

On the ownership of AI-generated content, the U.S. position has now been confirmed at every level. The Copyright Office's January 2025 report concluded that "prompts alone do not provide sufficient human control to make users of an AI system the authors of the output."\[47\] The D.C. Circuit affirmed the human-authorship requirement in *Thaler v. Perlmutter*, and on March 2, 2026 the Supreme Court declined to hear the case.\[48\] For creators and businesses, the practical rule is this. Purely machine-generated output is not copyrightable in the U.S. Human selection, arrangement and modification of that output can be.\[49\] Document your human contribution.

In Europe, the AI Act's timetable moved. The Digital Omnibus, Regulation (EU) 2026/1744, entered into force on July 27, 2026. It pushed obligations for stand-alone high-risk systems (in employment, credit, education, biometrics) to December 2, 2027, and for AI embedded in regulated products such as medical devices to August 2, 2028.\[50\]\[51\] The Article 50 transparency duties, including labeling of deepfakes, applied from August 2, 2026 as planned,\[52\] with the machine-readable marking duty for systems already on the market arriving December 2, 2026.\[50\]\[53\] The official reason for the delay was that harmonized standards and guidance weren't ready.\[54\]\[55\] Having lived inside standards-driven regulation, I find that entirely believable. You cannot demand conformity to a standard that doesn't exist yet.

### Healthcare: the most regulated deployment is also the most real

This is the area I know best, so let me be direct. Healthcare is the one domain where AI deployment is both extensive and genuinely validated, precisely because regulation forced the validation.

As of September 2026, the FDA states it has authorized over 1,600 AI-enabled medical devices for marketing in the United States.\[56\] The Imaging Wire's September 2026 analysis of the FDA list through June 2026 counts 1,614 AI-enabled devices, of which 1,230, or 76%, are radiology devices. GE HealthCare leads with 134 authorizations. The typical device is not a chatbot. It is image reconstruction that reduces noise so scans can be acquired faster or at lower dose, triage software that flags a suspected stroke or pulmonary embolism for faster reading, or detection aids for mammography and lung nodules. Most came through the 510(k) pathway by demonstrating substantial equivalence to an existing device.\[57\] Notably, no FDA-authorized device yet uses a continuously learning model.\[58\] Manufacturers instead use predetermined change control plans that specify in advance how a model may be updated and re-validated. As of March 2026, industry trackers reported that no device powered by generative AI or large language models had been authorized.\[59\] I haven't found evidence that this has changed since.

The contrast with general-purpose AI is instructive. A cleared imaging algorithm has a defined intended use, a characterized training population, a locked version, performance measured against a reference standard, and postmarket surveillance. That is exactly the verification-and-validation discipline the rest of the AI industry is only beginning to improvise. Where generative AI *has* spread quickly in medicine, as with ambient scribes that draft clinical notes from a recorded visit, it has mostly done so in documentation workflows that fall outside device regulation, with the clinician reviewing and signing the note. That is a reasonable place to start. It also means the evidence base for those tools is thinner than for the cleared devices. Drug discovery remains promising and early. AI-designed molecules are in clinical trials, but the approvals that would prove the case are still ahead.

My systems-engineer view: the device model isn't a drag on medical AI. It's the reason medical AI can be trusted. The EU's decision to give embedded, regulated-product AI until 2028 recognizes that these products already live inside a mature conformity regime.

### Labor: the bottom rung is where it hurts

The labor data finally has enough signal to say something specific, and it is not "mass unemployment."

The most careful work is the Stanford Digital Economy Lab's "Canaries in the Coal Mine" study by Erik Brynjolfsson, Bharat Chandar and Ruyu Chen. It is built on ADP payroll records and was updated in August 2026. It finds no evidence of widespread, economy-wide displacement.\[60\]\[61\] What it does find is a stark age split. Employment of 22-to-25-year-olds in the most AI-exposed occupations now stands 19% below where it would be had it kept pace with less-exposed work. Their employment in the two most exposed occupational groups fell about 11% between November 2022 and June 2026, while the same age group in the least-exposed groups grew about 10%. Experienced workers in the same occupations show no comparable shortfall, and the gap comes mainly from hiring fewer juniors rather than firing seniors.\[62\] The effect is concentrated where AI automates tasks rather than augments them.\[63\]

Other data point the same way with the usual measurement noise. Challenger, Gray & Christmas counts AI among the stated reasons for a growing share of announced job cuts in 2026, though employer-stated reasons are an imperfect signal.\[64\] Some large employers are moving the other way: IBM said it would triple U.S. entry-level hiring in 2026 while redesigning those roles around AI.\[65\]

The implication worries me more than the headline. Professions reproduce themselves through apprenticeship. Junior analysts, associates and developers learn judgment by doing the routine work that AI now absorbs. If firms stop hiring the bottom rung, the shortage shows up a decade later as a missing cohort of seniors. It is a slow-moving systems failure: invisible in quarterly numbers, obvious in retrospect.

### Geopolitics: the chip war, and the month export controls reached a model

The U.S.–China technology contest had two distinct stories this year: one about chips, and one about models.

On chips, the U.S. relaxed and the data stayed stark. In January 2026 the Commerce Department's Bureau of Industry and Security moved Nvidia H200 exports to China from presumption of denial to case-by-case review, with a 25% fee attached.\[66\]\[67\] The Council on Foreign Relations argues the underlying hardware gap is large and growing. It estimates the best U.S. AI chips are about five times more powerful than Huawei's best, widening to roughly seventeen times by the second half of 2027. It also notes that Huawei doesn't plan a chip exceeding the H200 until its Ascend 960 in late 2027.\[68\]\[69\] Beijing, for its part, has throttled H200 purchases to protect domestic suppliers, and by late August Huawei's Ascend 910C was reportedly sold out even as the H200 supply gap persisted.\[67\]\[70\] Proponents of the H200 decision argue it keeps Chinese developers tied to Nvidia's software ecosystem. Critics argue it hands China compute it cannot build itself.\[66\]\[69\] Both effects are probably real, and reasonable people weigh them differently.

On models, the gap is narrower than the chip numbers suggest. DeepSeek V4 launched with day-zero support from Huawei Ascend, Cambricon and Hygon hardware. Analysts placed it roughly three to six months behind the Western frontier on standard reasoning at launch,\[12\]\[71\] and Chinese open-weight models such as Kimi, Qwen and GLM crowd the top of the open leaderboards. Reports conflict on how much of V4's *training* ran on Huawei silicon rather than Nvidia.\[12\]\[72\] What is clear is that Chinese labs have become very good at doing more with less compute, which is exactly the adaptation export controls were likely to provoke.

Then came June. On June 9, 2026, Anthropic released Claude Fable 5, its most capable generally available model, alongside Claude Mythos 5, a cybersecurity-capable companion restricted to vetted partners through a consortium called Project Glasswing.\[73\]\[74\] On June 12, the Commerce Department sent Anthropic an export-control directive, signed by Secretary Howard Lutnick and citing national-security authorities. It required the company to suspend access to both models by any foreign national, whether inside or outside the United States, including Anthropic's own foreign-national employees.\[75\]\[76\] Because Anthropic could not reliably screen users by nationality, it disabled both models for everyone. Its other models, including Claude Opus 4.8, remained available.\[76\]\[77\] Reporting indicated the government's concern centered on a claimed jailbreak that could expose Mythos-class cybersecurity reasoning. The underlying directive was not published, so that rationale cannot be independently verified.\[76\]\[78\] On June 26 Commerce approved restoring Mythos 5 to certain named U.S. organizations, with Lutnick reserving "the right to reevaluate."\[75\]\[79\] On June 30 the controls on both models were lifted, and Anthropic began restoring access on July 1.\[74\] OpenAI's GPT-5.6 was similarly held to a limited partner preview in late June amid government review before its public July 9 release.\[5\]\[79\]

I want to treat this even-handedly, because both sides have a serious argument. Supporters of the action see it as the government doing what it should: treating frontier cyber-offense capability as a dual-use technology like any other, and acting quickly when a specific risk was flagged. Critics, including a group of security researchers who published an open letter, see an ad hoc, opaque process. It had no published rule, it was applied by nationality to a globally deployed service, and it disrupted enterprise customers for 19 days.\[73\]\[76\] What seems beyond dispute is the precedent. For the first time, the U.S. government used export-control authority to compel a company to withdraw specific deployed model versions.\[78\] Every lab and every multinational customer now has to plan for that possibility.

### Safety, synthetic media, and companions

The June episode is also the clearest sign that AI safety has become operational rather than theoretical. Labs now publish system cards with dangerous-capability evaluations. They run red-team exercises before launch and gate the most capable models behind partner programs. Governments now act on those evaluations. Whether alignment research is keeping pace with capability is still an open question, and I'd answer it honestly with "not obviously." Interpretability is producing real insight. Behavioral evaluations remain the main line of defense, and they are only as good as the scenarios someone thought to test.

Synthetic media moved from warning to enforcement. The U.S. TAKE IT DOWN Act's platform provisions became enforceable on May 19, 2026. Covered platforms must remove nonconsensual intimate imagery, including AI deepfakes, within 48 hours of a valid request, with the FTC enforcing.\[80\]\[81\] The EU's Article 50 labeling rules followed in August.\[52\] Detection tools remain an arms race that detectors structurally lose. That is why regulators have shifted toward provenance and labeling at the point of generation, and toward fast removal once harm occurs.

Companion AI is the most human and, to me, the most troubling part of the landscape. Chatbots designed to be friends, partners or confidants are now used by millions, and lawsuits such as *Raine v. OpenAI* allege that conversational AI failed vulnerable young users in the worst possible way.\[82\] California's SB 243 took effect January 1, 2026. It requires companion-chatbot operators to disclose that users are talking to an AI, remind known minors at least every three hours to take a break, maintain published crisis-response protocols, and face private lawsuits for violations.\[83\]\[84\]\[85\] Other states have followed.\[86\] The deeper problem isn't solvable by disclosure alone. A system optimized for engagement will learn that being endlessly agreeable keeps people talking. The attachment is real even when the relationship isn't, and I don't think we yet have good norms for products that are this good at being liked.

### What ordinary people mean by "alignment," and the creative stalemate

For researchers, "alignment" means getting a model to reliably pursue the goals its designers intend. For most people I talk to, it means something simpler: *can I trust it, and whose side is it on?* That framing matters. Public trust in AI tracks less with benchmark scores than with experiences of the model being confidently wrong, sycophantic, or evasive. Every model that flatters a user's bad idea is an alignment failure in the only sense most people will ever notice.

The creative world has reached something like a boring equilibrium, which I mean as a compliment. After the 2023–2024 panic, most working artists, writers and musicians I read about seem to have settled into a pragmatic split. They use AI as an instrument for drafts, reference, cleanup and ideation, and they fiercely defend the parts of their work that are about having something to say. The courts' insistence on human authorship reinforces that line. The anger that remains is mostly about consent and compensation for training data, which is exactly the fight the *Bartz* settlement began to price. Machines can generate endless competent content. What remains scarce, and what audiences still seem to pay for, is intention.

### Recommendations: how to use AI like an engineer

Pulling this together, here is what I'd tell any organization, or any curious individual, trying to make decisions in late 2026:

1. **Build your own evals.** Vendor benchmark scores are closed-track numbers. Before any deployment, test models on a held-out set of your own tasks with your own scaffolding, and measure against a baseline.
2. **Design for compounding error.** For agents, keep chains short, insert verification checkpoints, and put humans where a failure would be costly. Reliability comes from the system architecture, not the model alone.
3. **Treat data provenance as a legal asset.** After *Bartz*, how training and fine-tuning data were acquired is a liability question. Keep records.
4. **Plan for regulatory and geopolitical interruption.** The June 2026 suspension shows that access to a specific model can vanish overnight. Standard interfaces like MCP make multi-model fallback practical, so use them.
5. **Protect the bottom rung.** If AI is absorbing junior work, redesign junior roles around review and judgment rather than eliminating them. Otherwise you are borrowing against your future senior talent.

### Conclusion: the measurement problem

In astrophysics, there's a moment every observer dreads. The instrument saturates. The star is so bright that every pixel reads maximum, and you can no longer tell how bright it actually is. You haven't learned that the star is infinitely bright. You've learned that you need a better instrument.

That is where AI is in September 2026. The needle is pinned on the old tests, and the capabilities are real and extraordinary. But the questions that matter now aren't answered by leaderboards. Will this system do this job, under these conditions, every time, and fail safely when it doesn't? Who is accountable when it doesn't? Who gets paid for the knowledge it was built on, and who gets to decide when it is switched off?

Those are verification, validation and governance questions. Engineers in regulated industries have been answering questions like them for decades, slowly and unglamorously, with test protocols, traceability and humility about what the data actually shows. The AI industry is now learning that discipline in public, at scale, under pressure. I'd bet on the organizations that learn it fastest, and I wouldn't put much weight on the next number that pins the needle.

### Sources

1. [SWE-bench Verified Leaderboard 2026: Latest Coding Agent Scores](https://leaderboard.steel.dev/leaderboards/swe-bench-verified/)
2. [SWE-bench (Vals) Leaderboard & Scores — September 2026](https://benchlm.ai/benchmarks/valsswebench)
3. [SWE-bench Pro Leaderboard (September 2026): Every Model Score, Benchmarks, and Price per Point](https://www.morphllm.com/swe-bench-pro)
4. [SWE-bench Verified Leaderboard 2026: Top Models Ranked](https://localaimaster.com/models/swe-bench-explained-ai-benchmarks)
5. [GPT-5.6](https://en.wikipedia.org/wiki/GPT-5.6)
6. [Anthropic drops an amazing report on LLM interpretability](https://medium.com/@lee.fischman/anthropic-drops-an-amazing-report-on-llm-interpretability-d3fbcd5ba762)
7. [Circuit Tracing: A Step Closer to Understanding Large Language Models](https://towardsdatascience.com/circuit-tracing-a-step-closer-to-understanding-large-language-models/)
8. [Stop guessing why your LLMs break: Anthropic's new tool shows you exactly what goes wrong](https://venturebeat.com/ai/stop-guessing-why-your-llms-break-anthropics-new-tool-shows-you-exactly-what-goes-wrong)
9. [Transformer Circuits Thread](https://transformer-circuits.pub/)
10. [Understanding Mechanistic Interpretability in AI Models](https://intuitionlabs.ai/articles/mechanistic-interpretability-ai-llms)
11. [DeepSeek (chatbot)](<https://en.wikipedia.org/wiki/DeepSeek_(chatbot)>)
12. [DeepSeek V4 Ships 1M Context, Open-Weights](https://winbuzzer.com/2026/04/27/deepseek-v4-open-weights-launch-xcxwbn/)
13. [DeepSeek V4 on Huawei Ascend: 1.6T MoE, \$1.74 Token Price \[2026\]](https://tech-insider.org/deepseek-v4-huawei-ascend-1-6-trillion-parameter-moe-2026/)
14. [SWE-bench Verified Leaderboard (September 2026): Top Scores](https://benchlm.ai/benchmarks/swe-bench-verified)
15. [Desktop-Delta Bench: Do Computer-Use Models Understand Desktop GUI Transitions?](https://arxiv.org/pdf/2607.26041)
16. [David Rein - METR](https://metr.org/team/david-rein/)
17. [How Benchmarks Mis-Score Computer-Use Agents](https://arxiv.org/pdf/2607.28367)
18. [MCP Enterprise Adoption Guide 2026: Stats, Vendors, Security, guptadeepak.com](https://guptadeepak.com/the-complete-guide-to-model-context-protocol-mcp-enterprise-adoption-market-trends-and-implementation-strategies/)
19. [Everything your team needs to know about MCP in 2026 — WorkOS](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)
20. [Big tech takes steps to build open standards for agentic AI](https://www.ciodive.com/news/big-tech-develop-open-standards-agentic-ai/807608/)
21. [MCP 2026 Roadmap: Linux Foundation Move, MCP Apps ...](https://mcpplaygroundonline.com/blog/mcp-2026-roadmap-whats-changing-for-developers)
22. [ChatGPT Statistics 2026: Users, Revenue & Growth](https://www.getpanto.ai/blog/chatgpt-statistics)
23. [AI & ChatGPT Statistics for 2026 (Usage & Adoption Data)](https://www.instantpress.co/ai-statistics)
24. [Gemini 1 Billion Users: Monthly vs ChatGPT's Weekly](https://explainx.ai/blog/gemini-1-billion-users-monthly-vs-weekly-metric-august-2026)
25. [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity - METR](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)
26. [METR’s study on how AI affects developer productivity](https://newsletter.getdx.com/p/metr-study-on-how-ai-affects-developer-productivity)
27. [METR’s developer productivity research: 2026 update](https://blog.robbowley.net/2026/04/04/metrs-developer-productivity-research-2026-update/)
28. [We are Changing our Developer Productivity Experiment Design - METR](https://metr.org/blog/2026-02-24-uplift-update/)
29. [Enterprise AI ROI Measurement in 2026: Only 5-8% of Companies See Real Returns on \$186M Budgets](https://valueaddvc.com/blog/enterprise-ai-roi-in-2026-what-companies-are-actually-measuring-and-finding)
30. [Google updates AI Overviews with Further Exploration links, subscription labels as 58% publisher click decline triggers antitrust suits](https://thenextweb.com/news/google-ai-overviews-publisher-links-search-traffic)
31. [Researchers find Google AI Overviews cut publisher clicks 39.8%](https://ppc.land/researchers-find-google-ai-overviews-cut-publisher-clicks-39-8/)
32. [Google's AI Overviews and Publisher Traffic: How Antitrust Filing Reveals 58% Click Decline and the Breakdown of the Web Ecosystem](https://almcorp.com/blog/google-ai-overviews-publisher-traffic-decline-antitrust-lawsuit-analysis/)
33. [District Court Issues AI Fair Use Decision: Using Copyrighted Works to Train AI Models Is Fair Use, but Using Pirated Copies to Build a Central Library Is Not](https://www.goodwinlaw.com/en/insights/publications/2025/06/alerts-practices-aiml-district-court-issues-ai-fair-use-decision)
34. [Judge Alsup: Training AI On Copyrighted Works? Fair Use. Building Pirate Libraries? Not So Much](https://www.techdirt.com/2025/06/26/judge-alsup-training-ai-on-copyrighted-works-fair-use-building-pirate-libraries-not-so-much/)
35. [Andrea Bartz](https://en.wikipedia.org/wiki/Andrea_Bartz)
36. [Anthropic Settlement Update: Final Settlement Approved - Writer Beware](https://writerbeware.blog/2026/07/23/anthropic-settlement-update-final-settlement-approved/)
37. [Bartz v. Anthropic PBC, 4:24-cv-05417](https://www.courtlistener.com/docket/69058235/bartz-v-anthropic-pbc/?filed_after=&amp=&filed_before=&amp=&entry_gte=&amp=&entry_lte=&amp=&order_by=desc)
38. [UPDATE: Publishers’ Coordination Counsel files notice of appeal of fee award in Bartz v. Anthropic. Does not affect payout schedule.](https://chatgptiseatingtheworld.com/2026/08/18/update-publishers-coordination-counsel-files-notice-of-appeal-in-bartz-of-fee-award-does-not-affect-payout-schedule/)
39. [Bartz v. Anthropic: Settlement reached after landmark summary judgment and class certification](https://www.insidetechlaw.com/blog/2025/09/bartz-v-anthropic-settlement-reached-after-landmark-summary-judgment-and-class-certification)
40. [Client Alert - Summary and Strategic Analysis of Judge Chhabria’s Fair Use Ruling in Kadrey v. Meta - FisherBroyles](https://fisherbroyles.com/news/client-alert-summary-and-strategic-analysis-of-judge-chhabrias-fair-use-ruling-in-kadrey-v-meta/)
41. [Kadrey v. Meta gets scheduling order. Summary judgment motion hearing for distribution claim won’t be heard until Feb. 25, 2027](https://chatgptiseatingtheworld.com/2026/03/27/kadrey-v-meta-gets-scheduling-order-summary-judgment-motion-hearing-for-distribution-claim-wont-be-heard-until-feb-25-2027/)
42. [AI vs. Authors Update: Court Approves Historic Anthropic Settlement While Meta Litigation Continues](https://natlawreview.com/article/ai-vs-authors-update-court-approves-historic-anthropic-settlement-while-meta)
43. [Getty Images v Stability AI: A landmark judgment reinforcing the need for the UK government to amend its copyright laws](https://legalblogs.wolterskluwer.com/copyright-blog/getty-images-v-stability-ai-a-landmark-judgment-reinforcing-the-need-for-the-uk-government-to-amend-its-copyright-laws/)
44. [High Court grants permission to appeal in Getty Images v Stability AI - Wiggin LLP : Wiggin LLP](https://www.wiggin.co.uk/insight/high-court-grants-permission-to-appeal-in-getty-images-v-stability-ai/)
45. [NYT v. OpenAI & Microsoft — Lawsuit Status & Rulings (2026)](https://ailawsuittracker.com/cases/new-york-times-v-openai/)
46. [NYT v OpenAI Lawsuit Status 2026 - AI Vortex](https://www.aivortex.io/legal/ai-case-law/nyt-v-openai/)
47. [Part Two: Copyright Office AI Report Says Creative Prompting Doesn’t Constitute Authorship](https://ipwatchdog.com/2025/01/29/part-two-copyright-office-ai-report-says-creative-prompting-doesnt-constitute-authorship/)
48. [Supreme Court Declines to Hear Thaler v. Perlmutter, Leaving Human Authorship Requirement Intact](https://www.finnegan.com/en/insights/ip-updates/supreme-court-declines-to-hear-thaler-v-perlmutter-leaving-human-authorship-requirement-intact.html)
49. [U.S. Supreme Court Denies Certiorari in Thaler v. Perlmutter AI Authorship Case, March 2026](https://www.prokopievlaw.com/post/u-s-supreme-court-denies-certiorari-in-thaler-v-perlmutter-ai-authorship-case-march-2026)
50. [EU AI Act Deal: Digital Omnibus Now in Force](https://usercentrics.com/knowledge-hub/eu-ai-act-high-risk-delay-article-50-transparency-consent/)
51. [EU AI Act Omnibus Agreement — Postponed High-Risk Deadlines and Other Key Changes - Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)
52. [Deepfake Regulation 2026: The Shifts](https://newduckduckgoose.webflow.io/blog/deepfake-regulation-2026-whats-changing)
53. [AI Act rules on high-risk AI delayed as AI Digital Omnibus agreed - Winston Taylor](https://www.winstontaylor.com/insights/ai-act-rules-on-high-risk-ai-delayed-as-ai-digital-omnibus-agreed)
54. [AI Act August 2026: What to expect - delayed standards, pending guidance, and the Digital Omnibus on AI](https://plesner.com/en/news/ai-act-august-2026-what-expect-delayed-standards-pending-guidance-and-digital-omnibus-ai)
55. [Rules on 'high-risk' AI to be delayed under EU 'omnibus' deal](https://www.pinsentmasons.com/out-law/news/rules-high-risk-ai-delayed-under-eu-omnibus-deal)
56. [Artificial Intelligence-Enabled Medical Devices](https://www.fda.gov/medical-devices/digital-health-center-excellence/artificial-intelligence-enabled-medical-devices)
57. [FDA’s Latest Lists for Digital Health Technologies](https://www.thefdalawblog.com/2025/07/fdas-latest-lists-for-digital-health-technologies/)
58. [How Is FDA Regulating AI Medical Devices in 2026?](https://www.mddionline.com/artificial-intelligence/fda-ai-medical-device-guidelines-2026-expert-legal-perspective-on-compliance)
59. [The Current State Of FDA-Approved AI-Enabled Medical Devices](https://medicalfuturist.com/the-current-state-of-fda-approved-ai-based-medical-devices/)
60. [Canaries in the Coal Mine? Six Facts about the Recent Employment](https://digitaleconomy.stanford.edu/app/uploads/2026/08/Canaries_August2026.pdf)
61. [Class of 2026: What occupation data show about AI and the young college graduate workforce](https://www.epi.org/blog/class-of-2026-what-occupation-data-show-about-ai-and-the-young-college-graduate-workforce/)
62. [AI’s first visible employment shock may be hitting the bottom rung of the career ladder: by June 2026, employment among 22–25-year-olds in highly AI-exposed occupations was running 19% behind their less-exposed peers, largely because companies were hiring fewer juniors—not firing experienced workers—raising an uncomfortable question about who becomes tomorrow’s senior analyst, lawyer or coder. - Silicon Canals](https://siliconcanals.com/t-ai-entry-level-employment-gap-career-ladder/)
63. [new study finds ai is cutting entry level hiring as young workers lose jobs](https://www.tipranks.com/news/new-study-finds-ai-is-cutting-entry-level-hiring-as-young-workers-lose-jobs)
64. [AI and the Job Market in 2026: What the Data Actually Shows - The Pivot Wave](https://thepivotwave.com/blog/ai-and-job-market-statistics/)
65. [AI Is Reshaping The Entry-Level Job Market. Young Workers May Need A New Way In.](https://www.inkl.com/news/ai-is-reshaping-the-entry-level-job-market-young-workers-may-need-a-new-way-in)
66. [White House U-turn on Nvidia H200 AI accelerator exports down to Huawei's powerful new Ascend chips, report claims — U.S. committed to 'dominance of the American tech stack'](https://www.tomshardware.com/tech-industry/white-house-u-turn-on-nvidia-h200-ai-accelerator-exports-down-to-huaweis-powerful-new-ascend-chips-report-claims-u-s-committed-to-dominance-of-the-american-tech-stack)
67. [NVIDIA H200 China Shipment 2026: What It Means for GPU Pricing](https://www.spheron.network/blog/nvidia-h200-china-shipment-2026/)
68. [\[News\] U.S. Council: NVIDIA–Huawei AI Chip Gap Could Reach 17× by 2H27, Yet H200 Exports Risk Aiding China](https://www.trendforce.com/news/2025/12/19/news-u-s-council-nvidia-huawei-ai-chip-gap-could-reach-17x-by-2h27-yet-h200-exports-risk-aiding-china/)
69. [chinas ai chip deficit why huawei cant catch nvidia and us export controls should remain](https://cfr.org/articles/chinas-ai-chip-deficit-why-huawei-cant-catch-nvidia-and-us-export-controls-should-remain)
70. [Huawei's Ascend 910C sold out in China, but Nvidia's H200 supply gap persists](https://www.digitimes.com/news/a20260828PD207/huawei-ascend-nvidia-chips-china-2026.html)
71. [\[News\] Huawei Ascend, Cambricon and Hygon Completed Day 0 Adaptation to DeepSeek-V4](https://www.trendforce.com/news/2026/04/29/news-huawei-ascend-cambricon-and-hygon-completed-day-0-adaptation-to-deepseek-v4/)
72. [DeepSeek V4 is here: the open model that made Jensen Huang's 'horrible outcome' real](https://whatllm.org/blog/deepseek-v4-preview)
73. [U.S. lifts export controls on Anthropic's Claude Fable 5 and Mythos 5, ending 19-day shutdown](https://www.marketscale.com/industries/software-and-technology/us-lifts-export-controls-on-anthropics-claude-fable-5-and-mythos-5-ending-19-day-shutdown)
74. [Claude Mythos](https://en.wikipedia.org/wiki/Claude_Mythos)
75. [Anthropic says Trump admin has lifted export controls on Claude Fable 5 and Mythos 5](https://www.cnbc.com/2026/06/30/anthropic-says-trump-admin-has-lifted-export-controls-on-claude-fable-5-and-mythos-5.html)
76. [The Fable 5 / Mythos 5 Export-Control Action](https://labs.cloudsecurityalliance.org/research/governance-fable-mythos-export-control-v1-0/)
77. [Did the US Government Just Set An AI Export Precedent by Blocking Mythos?](https://www.techpolicy.press/did-the-us-government-just-set-an-ai-export-precedent-by-blocking-mythos/)
78. [Fable 5 Suspension: Enterprise AI Under Export Controls](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-model-export-controls-enterprise-govern/)
79. [Commerce Department greenlights partial return of Anthropic's Mythos](https://www.axios.com/2026/06/27/commerce-anthropic-mythos-restrictions-lift)
80. [The TAKE IT DOWN Act Is Now Law: What Platform Operators Must Have in Place Before May 19](https://compliancehub.wiki/take-it-down-act-ftc-enforcement-deepfake-platform-compliance-2026/)
81. [TAKE IT DOWN Act: Platform Compliance Guide (FTC Enforcement Begins May 19, 2026)](https://www.ailawsbystate.com/blog/take-it-down-act-platform-compliance-guide-2026)
82. [Raine v. OpenAI](https://en.wikipedia.org/wiki/Raine_v._OpenAI)
83. [California SB 243 Explained: AI Chatbot Law Guide 2026](https://www.getlimina.ai/en/blog/california-sb-243-companion-chatbot-law)
84. [Understanding the New Wave of Chatbot Legislation: California SB 243 and Beyond - Future of Privacy Forum](https://fpf.org/blog/understanding-the-new-wave-of-chatbot-legislation-california-sb-243-and-beyond/)
85. [United States - California - Chatbot Disclosure Requirements (SB 243)](https://regulations.ai/regulations/RAI-US-CA-CS2CCXX-2025)
86. [Companion Chatbot Laws: State Compliance Guide 2026 — CA SB 243, WA HB 2225, NE LB 525](https://www.ailawsbystate.com/blog/companion-chatbot-laws-state-compliance-guide-2026)
