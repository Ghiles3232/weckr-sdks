# Northwind Analytics: Q2 2026 Platform Review

Prepared by the Platform Engineering group for the executive team and the board technology committee. Circulated 2026-07-02. Internal use only.

## 1. Executive summary

Q2 was the first full quarter running on the consolidated ingestion pipeline that replaced the legacy dual write architecture. The migration completed on 2026-04-18, eleven days later than the plan approved in March, and it delivered most of what it promised. Ingestion throughput rose from a sustained 42,000 events per second to a sustained 118,000 events per second at the same instance count. Median end to end latency, measured from the moment an event is accepted at the edge to the moment it becomes queryable, fell from 8.4 seconds to 1.9 seconds. The p99 fell from 47 seconds to 6.2 seconds, which is the single largest improvement the platform has recorded since the company began tracking the metric in 2023.

Availability finished the quarter at 99.94 percent against a contractual commitment of 99.9 percent for the Business tier and 99.95 percent for the Enterprise tier. We missed the Enterprise commitment by four hundredths of a point because of a single incident on 2026-05-22 described in section 3. Service credits totalling 41,200 dollars were issued to nine Enterprise accounts. This is the second consecutive quarter in which a single incident consumed the entire Enterprise error budget, and section 9 treats that as a structural problem rather than bad luck.

Infrastructure spend was 1,284,000 dollars for the quarter against a budget of 1,410,000 dollars, so we came in 8.9 percent under. The saving is real but it is not entirely a credit to efficiency work. Roughly 62,000 dollars of it is a one time reserved instance credit that will not repeat, and a further 40,000 dollars reflects the delayed start of the analytics warehouse rebuild, which is deferred cost rather than avoided cost. Adjusted for both, true underspend was closer to 1.7 percent.

Two themes run through everything below. First, the platform is now fast enough that customer complaints have shifted from performance to correctness and clarity, which is a healthier place to be but demands a different kind of engineering attention. Second, our cost per unit of work is falling while our absolute spend is flat, because customers are simply sending more data. Efficiency work is buying us headroom, not savings, and the finance team should plan accordingly.

## 2. Reliability and performance

The consolidated pipeline removed the dual write path that had been in place since the 2024 storage migration. Under the old design every event was written to both the hot store and the durable log, with a reconciliation job resolving disagreements on a fifteen minute cycle. That job was the source of nine of the fourteen incidents recorded in 2025. It is now gone.

Throughput improved more than we modelled. The March forecast projected a sustained 85,000 events per second at the existing instance count. We are seeing 118,000. The difference comes almost entirely from removing serialisation overhead: events are now encoded once, in a compact binary format, rather than encoded twice in two different formats for two different consumers. Peak burst capacity, measured during the load test on 2026-06-11, reached 260,000 events per second before the ingest tier began shedding, which gives us roughly 2.2 times headroom over the current sustained peak.

Latency improvements are described in the summary. What the headline numbers hide is that the distribution is now much tighter. Under the old pipeline the ratio between p50 and p99 was 5.6. It is now 3.3. Tight distributions matter more than good averages for our customers, because most of them alert on their own dashboards and a long tail produces false alarms. Three Enterprise accounts have already told us they were able to relax their internal alerting thresholds as a result, which reduces their on call burden and, not incidentally, reduces the volume of support tickets that begin with a customer suspecting a problem on our side.

Query performance was flat, which was expected but is worth stating plainly because several stakeholders assumed the ingestion work would improve it. It did not, and it was never designed to. Query latency is governed by the analytics warehouse, which is unchanged and which is the subject of the deferred rebuild discussed in section 5. Median query time held at 340 milliseconds and p95 at 4.1 seconds across the quarter, both within target, but the p99 of 22 seconds is well outside target and has not moved in four quarters. Roughly 70 percent of those slow queries come from eleven accounts running unbounded time range scans, and section 7 covers the product response.

## 3. Incident review

Four incidents met the severity threshold for review this quarter, down from seven in Q1. Two are worth describing in detail.

### Incident 2026-05-22, severity 1, duration 94 minutes

At 14:06 UTC the ingest tier began rejecting roughly 40 percent of incoming events with a 503 status. The trigger was a routine credential rotation for the internal service account used by the ingest tier to authenticate against the durable log. The rotation itself succeeded. The problem was that the ingest tier caches credentials in memory for one hour and refreshes them on a timer, and the refresh path had a bug: on refresh failure it cleared the cached credential before attempting to fetch the new one, leaving a window in which the service had no credential at all. The refresh failed because the new credential had propagated to only three of five regions when the timer fired.

Recovery took 94 minutes, far longer than the eight minute detection time, because the automated rollback did not work. The rollback restores the previous credential, but the previous credential had already been marked revoked by the rotation system, so restoring it produced the same failure. The on call engineer eventually resolved it by forcing an early propagation and restarting the ingest fleet in a staggered pattern.

Three actions came out of this. The refresh path now fetches before it clears, which is a four line change that has been merged. Credential propagation is now verified across all regions before the old credential is revoked, which required a change to the rotation tooling and shipped on 2026-06-09. And the rollback runbook now includes an explicit check for whether the target credential is still valid, because the automated rollback silently succeeded while achieving nothing, which cost us at least thirty minutes.

The deeper lesson, and the one the team has been arguing about, is that this incident was caused by a safety mechanism. Credential rotation exists to limit blast radius if a credential leaks. It has now caused two incidents in eighteen months and prevented zero known leaks. That is not an argument for abandoning rotation, but it is an argument for treating safety automation with the same testing rigour as product code, which we currently do not.

### Incident 2026-06-30, severity 2, duration 3 hours 40 minutes

A schema change to the account metadata table added a column with a default value. On our Postgres version this is a metadata only operation and should have been instant. It was instant. What was not instant was the cache invalidation that followed: the deployment triggered a full invalidation of the account metadata cache, which holds roughly 400,000 entries, and the resulting stampede against the primary database pushed connection pool utilisation to 100 percent for the better part of an hour.

Customer impact was moderate. Queries continued to work but dashboard loads were slow, averaging 11 seconds against a normal 1.2 seconds. No data was lost and ingestion was unaffected because ingestion does not read account metadata on the hot path.

The fix is request coalescing on cache misses, so that a thousand simultaneous misses for the same key produce one database read rather than a thousand. This is a well understood pattern and it is faintly embarrassing that we did not have it. It shipped on 2026-07-01. We have also added a staged invalidation mode for deployments, which expires cache entries over a ten minute window rather than all at once.

## 4. Infrastructure cost

Total spend was 1,284,000 dollars, against 1,410,000 dollars budgeted and 1,201,000 dollars in Q1. The quarter over quarter increase of 6.9 percent came alongside a 31 percent increase in ingested event volume, so cost per million events fell from 4.12 dollars to 3.36 dollars, a decline of 18.4 percent. That is the number the team is proudest of and it is the number that matters for the unit economics discussion the board asked for in April.

Compute accounted for 604,000 dollars, storage for 391,000 dollars, network egress for 188,000 dollars, and managed services for the remaining 101,000 dollars. The largest single change from Q1 is a 74,000 dollar reduction in compute despite higher volume, which is a direct result of the pipeline consolidation. The largest single increase is network egress, up 44,000 dollars, driven almost entirely by two Enterprise customers who began exporting raw event streams to their own warehouses in May. We do not currently charge separately for egress on the Enterprise tier. At current growth that becomes a 300,000 dollar annualised line item attributable to four accounts, and the commercial team should decide whether that stays absorbed or becomes a metered add on.

Storage is the line we understand least well. It grew 12 percent while retained data grew 9 percent, and nobody has been able to explain the gap satisfactorily. The leading hypothesis is that compaction is running less frequently than configured because the compaction workers are being descheduled under memory pressure, leaving more redundant data on disk than the model assumes. An investigation is open and is expected to close in July.

Reserved capacity now covers 71 percent of steady state compute, up from 58 percent. The finance team has asked whether we should push toward 90 percent. Engineering's recommendation is no, or at least not yet. Reserved commitments are a bet on stable shape as well as stable volume, and the warehouse rebuild in Q3 will change the shape materially. Revisiting in Q4, once the rebuild has settled, is the safer sequence.

## 5. Analytics warehouse rebuild

The rebuild was scheduled to begin in May and did not. This was a deliberate decision made on 2026-05-04 in response to the pipeline migration overrun, on the reasoning that running two large migrations concurrently with one team was how we ended up with the 2024 storage incident. The team supported the deferral. It nonetheless means that the single largest source of customer visible slowness, the p99 query latency described in section 2, remains unaddressed for another quarter.

Design work continued during the deferral and the architecture is now settled. The rebuild replaces the current row oriented store with a columnar layout partitioned by account and time, which should reduce scan volume for the typical dashboard query by between 85 and 95 percent based on a prototype benchmarked against replayed production queries in June. Prototype results showed p99 falling from 22 seconds to 2.4 seconds on the same hardware. That result is encouraging but it was measured on a single account's data and should be treated as directional rather than a forecast.

The migration itself is the risk. It requires a full rewrite of historical data, roughly 940 terabytes, and there is no version of it that does not involve a period of dual serving where both stores must be kept consistent. That is the same pattern that caused the problems described in section 2. The mitigation is that dual serving here is read only on the new path until cutover, so a divergence produces a wrong answer in a shadow query that nobody sees rather than a wrong answer in production. Shadow comparison over at least two weeks is a hard gate before any account is cut over.

Estimated duration is fourteen weeks from start, with the first customer accounts cut over in week eight. Estimated one time cost is 210,000 dollars, mostly the transient double storage.

## 6. Support and customer operations

Ticket volume fell 22 percent quarter over quarter, from 3,140 to 2,449, against a customer base that grew 14 percent. Tickets per account per month is therefore down 31 percent, which is the sharpest decline the support organisation has recorded.

The composition changed as much as the volume. In Q1, 44 percent of tickets were performance related, meaning some variant of a customer reporting that data was late or a dashboard was slow. In Q2 that fell to 19 percent. The share described as correctness or clarity questions, meaning the customer believes a number is wrong or does not understand how it was computed, rose from 21 percent to 38 percent. Absolute volume of that category rose slightly, from 659 to 931.

This shift is the predictable consequence of fixing the loud problem. When data is nine seconds late, customers attribute everything to lateness. When it is two seconds late, they start reading the numbers carefully. The three most common correctness questions are all about the same underlying thing: how we handle events that arrive out of order relative to their own timestamps. Our behaviour here is correct and documented, but the documentation is in a reference page that nobody reads, and the dashboard gives no indication that a late arriving event has revised a number the customer looked at yesterday.

Median first response time was 2.1 hours against a 4 hour target. Median resolution time was 19 hours against a 48 hour target. Both improved. Customer satisfaction on resolved tickets was 4.5 out of 5, up from 4.2. The support team has been unusually vocal that the improvement is mostly the platform's doing rather than theirs, which is generous and probably accurate.

## 7. Product implications

Three things follow from the above and the product group has accepted all three into the Q3 plan.

The first is a revision indicator. When a metric on a dashboard has changed because of late arriving data, the interface should say so, with a timestamp and a link to an explanation. This is a small piece of work with an outsized effect on the largest category of support tickets.

The second is guardrails on unbounded queries. Eleven accounts generate 70 percent of slow queries by running scans across the full retention window, usually by accident, usually because a saved view has no time filter. Rather than making these queries faster, which the warehouse rebuild will do anyway, the interface should warn before running a query estimated to scan more than a threshold volume, and offer a bounded alternative. Three of the eleven accounts, when contacted, did not know the queries were running at all. They were scheduled reports nobody reads.

The third is egress visibility. Following from section 4, Enterprise customers exporting raw streams currently have no view of how much they are exporting. Whatever the commercial decision, giving customers the number before we give them a bill is the right sequence.

## 8. Security and compliance

The SOC 2 Type II observation window closed on 2026-06-30 with no exceptions carried forward. Two observations from the interim review were remediated during the quarter: privileged access review cadence moved from quarterly to monthly, and the offboarding checklist now includes an explicit revocation step for the internal analytics tool, which had been missed for two departing employees in 2025 without any evidence of misuse.

No security incidents met the reporting threshold. Two vulnerabilities in third party dependencies were rated high and patched within the seven day window, at three days and five days respectively.

Penetration testing by an external firm ran in June. The report identified four findings, none critical. The most significant was that our API rate limiting is applied per credential rather than per account, so an account holding multiple credentials receives a multiple of the intended limit. This is not exploitable by an outside party but it does mean our limits do not do what the documentation says they do. A fix is scheduled for Q3.

## 9. Organisation and the error budget problem

The group finished the quarter at 34 engineers against an approved headcount of 38. Four open roles have been open for more than ninety days, all of them in the data platform team, which is also the team that owns the warehouse rebuild. This is the most acute staffing risk on the plan.

Attrition was one engineer, voluntary, to a competitor. Exit feedback was unremarkable and cited compensation.

The structural issue flagged in the summary is the error budget. For two consecutive quarters, a single incident has consumed the entire Enterprise budget. The reflex reading is that we need higher reliability. The team's reading, which the group lead endorses, is different: our availability is fine on average and our failure mode is that incidents are long, not that they are frequent. Four incidents in a quarter is good. A 94 minute severity 1 is not. Both of the incidents described in section 3 had detection times under ten minutes and recovery times measured in hours, and in both cases the delay was in the response path rather than the detection path, specifically in automation that did not do what the runbook assumed it did.

The proposed response for Q3 is therefore not more monitoring. It is a programme of recovery drills, in which the automated recovery paths are exercised against real failures in a controlled window, on the theory that recovery automation which is never tested is indistinguishable from recovery automation which does not work. The first drill is scheduled for 2026-08-06.

## 10. Q3 priorities

In order of commitment: begin and reach the first customer cutover of the analytics warehouse rebuild; ship the revision indicator and the unbounded query guardrail; run at least two recovery drills and remediate what they find; close the storage growth investigation; fix per account rate limiting; and fill at least two of the four open data platform roles.

Explicitly not committed for Q3, despite requests: the multi region active active work, which depends on the warehouse rebuild completing first, and the customer facing audit log, which is a real gap but which the group does not have the capacity to do well this quarter.
