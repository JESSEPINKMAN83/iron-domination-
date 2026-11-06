# Opponent deterrence

AI assault groups now remember costly repulses per hostile army. When at least 60% of a wave's starting health is lost and it dealt little damage to the main army that hurt it (less than 35% of those losses), the commander records a setback. A wipe is assessed before dead units are removed from the squad. Earlier damage and successful exchanges do not qualify.

Damage attribution comes from confirmed combat exchanges on the commander's own units, including removed casualties. It does not compare hidden enemy balances, force counts or defenses. A third party that ambushes the wave is identified separately from the intended target. This applies equally to AI opponents and the human player; alliance checks exclude friendly armies.

Remembered opponents cost more in target selection. The AI can choose another visible opponent or scout a different known deployment sector. Existing production/economy targeting, flanks and air support remain. Independent air raids also prefer another sector after a known costly repulse.

If every known hostile opponent is deterrent, fresh raids wait at least 90 simulated seconds and require a group about 60% larger than normal. Prepared larger forces reduce the target penalty. Memory gradually fades over eight simulated minutes, so setbacks do not create permanent immunity or a permanent truce. Existing home guards and regrouping behavior remain.

Memory is stored on the commander's own HQ, alongside bounded per-army combat exchange counters on participating entities. Both serialize and participate in deterministic state hashes. Active squad bookkeeping follows the existing commander lifecycle. There is no new rendering work in normal matches; damage counters update on hits and decisions run on the existing AI reaction pulse.

## Local test

Use `/?start=test&deterrence-test=1&armies=4&sides=1,2,3,4&doctrines=iron-legion,missile-command,drone-network,expeditionary-force&ai=extra-hard&size=large&combat=assisted&time=day&weather=clear&seed=41`.

This starts a four-army free-for-all with ready forces and funds. Repel the first offensive, then expand the small **AI deterrence · local test** panel to see remembered setbacks and the minimum regroup timer. Another AI can also deter an opponent. The preview does not fabricate a defeat or pre-populate memories.

Tests cover wiped-out squads, actual damage attribution, meaningful damage/no false penalty, third-party attribution, visible target switching and honest scouting, larger delayed retries, fading, late reinforcement bookkeeping and save/hash persistence.
