//! Characterization + edge-case tests for the velocity scoring / escalation
//! money-math critical path.
//!
//! These tests pin the EXACT numeric behaviour of the scoring formula and the
//! threshold/classification logic so that any change to the weights,
//! normalization, clamping, or threshold boundaries fails loudly.
//!
//! They also document the SCALE-MISMATCH trap on this critical path:
//! `calculate_velocity_score` is documented (and asserted by its own unit
//! tests) to return a value in [0.0, 1.0], yet `classify_velocity`,
//! `should_auto_execute`, and `compute_threshold_breach` all operate on a
//! 0..100 scale. Feeding the raw composite score straight into the
//! classifier therefore ALWAYS yields `Cold` and NEVER auto-executes, no
//! matter how strong the underlying signal is. The tests below lock in both
//! the raw contract and the correctly-scaled bridge so a regression that
//! re-wires the two on mismatched scales is caught.

use metabocommand_kernel::*;

// ---------------------------------------------------------------------------
// calculate_velocity_score — exact formula characterization
//   score = 0.40*clamp(aph/100,0,1) + 0.30*clamp(success,0,1)
//           + 0.30*(1/(1 + art/60))
// ---------------------------------------------------------------------------

const EPS: f64 = 1e-9;

#[test]
fn score_perfect_inputs_is_exactly_one() {
    // 100 aph -> norm 1.0 ; success 1.0 ; art 0 -> speed 1.0
    // 0.40 + 0.30 + 0.30 = 1.0
    let s = calculate_velocity_score(100.0, 1.0, 0.0);
    assert!((s - 1.0).abs() < EPS, "got {s}");
}

#[test]
fn score_moderate_known_value() {
    // 50 aph -> 0.5*0.40 = 0.20
    // 0.8 success -> 0.8*0.30 = 0.24
    // 30s -> speed 1/(1+0.5)=0.6666.. ; *0.30 = 0.20
    // total = 0.64
    let s = calculate_velocity_score(50.0, 0.8, 30.0);
    assert!((s - 0.64).abs() < EPS, "expected 0.64, got {s}");
}

#[test]
fn score_second_known_value() {
    // 75 aph -> 0.75*0.40 = 0.30
    // 0.9 success -> 0.27
    // 12s -> speed 1/(1+0.2)=0.83333.. ; *0.30 = 0.25
    // total = 0.82
    let s = calculate_velocity_score(75.0, 0.9, 12.0);
    assert!((s - 0.82).abs() < 1e-9, "expected 0.82, got {s}");
}

#[test]
fn speed_norm_halves_at_sixty_seconds() {
    // At art=60s, speed_norm = 1/(1+1) = 0.5.
    // With zero actions and zero success the whole score is 0.30*0.5 = 0.15.
    let s = calculate_velocity_score(0.0, 0.0, 60.0);
    assert!((s - 0.15).abs() < EPS, "expected 0.15, got {s}");
}

// ---- edge / boundary / overflow-prone cases -------------------------------

#[test]
fn score_actions_per_hour_is_clamped_high() {
    // Absurdly large throughput must clamp at norm=1.0, not blow past it.
    let s = calculate_velocity_score(1.0e9, 1.0, 0.0);
    assert!((s - 1.0).abs() < EPS, "huge aph should clamp to 1.0, got {s}");
    // Anything finite must stay <= 1.0 — guards against an unclamped weight bug.
    assert!(s <= 1.0 + EPS);
}

#[test]
fn score_negative_actions_floor_to_zero() {
    // Negative actions/hr must clamp to 0 contribution (no negative throughput).
    // success -1 clamps to 0 ; 30s speed=0.6666 ; only speed term survives:
    // 0.30 * 0.66666.. = 0.20
    let s = calculate_velocity_score(-50.0, -1.0, 30.0);
    assert!((s - 0.2).abs() < EPS, "expected 0.20, got {s}");
    assert!(s >= 0.0, "score must never go negative, got {s}");
}

#[test]
fn score_success_rate_above_one_is_clamped() {
    // A success_rate of 5.0 (bad upstream data) must not inflate the score.
    // 100 aph -> 0.40 ; success clamps to 1.0 -> 0.30 ; art 0 -> 0.30 = 1.0
    let s = calculate_velocity_score(100.0, 5.0, 0.0);
    assert!((s - 1.0).abs() < EPS, "over-unity success must clamp, got {s}");
}

#[test]
fn score_huge_response_time_drives_speed_to_zero() {
    // As art -> infinity, speed_norm -> 0. Only actions+success remain.
    // 100 aph -> 0.40 ; 1.0 success -> 0.30 ; speed ~0 -> total ~0.70
    let s = calculate_velocity_score(100.0, 1.0, 1.0e12);
    assert!((s - 0.70).abs() < 1e-6, "expected ~0.70, got {s}");
}

#[test]
fn score_is_bounded_in_unit_interval_across_a_grid() {
    // Property-style sweep: the documented contract is [0,1]. Catch any
    // weighting change that lets the score escape the unit interval.
    for &aph in &[-100.0, 0.0, 33.0, 100.0, 1000.0] {
        for &sr in &[-1.0, 0.0, 0.5, 1.0, 9.0] {
            for &art in &[0.0, 1.0, 60.0, 600.0] {
                let s = calculate_velocity_score(aph, sr, art);
                assert!(
                    (0.0..=1.0).contains(&s),
                    "score {s} out of [0,1] for aph={aph} sr={sr} art={art}"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// classify_velocity — boundary behaviour on the 0..100 scale
// ---------------------------------------------------------------------------

#[test]
fn classify_boundaries_are_inclusive_lower_bounds() {
    // Exactly-on thresholds belong to the higher tier (>=).
    assert_eq!(classify_velocity(80.0), VelocityTier::Critical);
    assert_eq!(classify_velocity(60.0), VelocityTier::Hot);
    assert_eq!(classify_velocity(40.0), VelocityTier::Warm);
    // Just below each boundary drops a tier.
    assert_eq!(classify_velocity(79.999), VelocityTier::Hot);
    assert_eq!(classify_velocity(59.999), VelocityTier::Warm);
    assert_eq!(classify_velocity(39.999), VelocityTier::Cold);
}

#[test]
fn classify_handles_negative_and_extreme() {
    assert_eq!(classify_velocity(-10.0), VelocityTier::Cold);
    assert_eq!(classify_velocity(1.0e6), VelocityTier::Critical);
}

// ---------------------------------------------------------------------------
// should_auto_execute — the money guardrail: only fire when fast AND safe
// ---------------------------------------------------------------------------

#[test]
fn auto_execute_requires_both_high_score_and_low_risk() {
    assert!(should_auto_execute(70.0, 0.0));
    assert!(should_auto_execute(70.0, 0.299));
    // score boundary is inclusive (>=70), risk boundary is exclusive (<0.3)
    assert!(!should_auto_execute(69.999, 0.0), "score below 70 must block");
    assert!(!should_auto_execute(70.0, 0.3), "risk exactly at cap must block");
    assert!(!should_auto_execute(100.0, 0.30001), "risk over cap must block");
}

#[test]
fn auto_execute_never_fires_on_negative_or_nan_safe_inputs() {
    assert!(!should_auto_execute(-5.0, 0.0));
    // NaN comparisons are always false, so a NaN score must NOT auto-execute.
    assert!(!should_auto_execute(f64::NAN, 0.0));
    // A NaN risk likewise must not pass the `< 0.3` gate.
    assert!(!should_auto_execute(99.0, f64::NAN));
}

// ---------------------------------------------------------------------------
// compute_threshold_breach — majority-of-window escalation trigger
// ---------------------------------------------------------------------------

#[test]
fn breach_false_when_current_at_or_below_threshold() {
    assert!(!compute_threshold_breach(50.0, 50.0, 3, &[99.0, 99.0, 99.0]));
    assert!(!compute_threshold_breach(49.0, 50.0, 3, &[99.0, 99.0, 99.0]));
}

#[test]
fn breach_requires_strict_majority_of_window() {
    // Window of 4, exactly 2 exceeding -> NOT a strict majority (2 > 4/2=2 is false).
    let history = vec![60.0, 60.0, 10.0, 10.0];
    assert!(
        !compute_threshold_breach(60.0, 50.0, 4, &history),
        "a 2/4 tie must not count as a breach"
    );
    // 3 of 4 exceeding -> majority.
    let history = vec![60.0, 60.0, 60.0, 10.0];
    assert!(compute_threshold_breach(60.0, 50.0, 4, &history));
}

#[test]
fn breach_uses_only_the_trailing_window() {
    // Old values exceed, but only the trailing window_size=2 is consulted,
    // and those are below threshold -> no breach despite current>threshold.
    let history = vec![99.0, 99.0, 99.0, 10.0, 10.0];
    assert!(!compute_threshold_breach(60.0, 50.0, 2, &history));
}

#[test]
fn breach_with_empty_history_falls_back_to_current_only() {
    assert!(compute_threshold_breach(60.0, 50.0, 5, &[]));
    assert!(compute_threshold_breach(60.0, 50.0, 0, &[]));
}

// ---------------------------------------------------------------------------
// deceleration_rate & moving average
// ---------------------------------------------------------------------------

#[test]
fn deceleration_is_prev_minus_last() {
    // positive => slowing down
    assert!((deceleration_rate(&[80.0, 60.0]) - 20.0).abs() < EPS);
    // negative => accelerating
    assert!((deceleration_rate(&[60.0, 80.0]) - (-20.0)).abs() < EPS);
    // fewer than two points => 0
    assert!((deceleration_rate(&[42.0]) - 0.0).abs() < EPS);
    assert!((deceleration_rate(&[]) - 0.0).abs() < EPS);
}

#[test]
fn moving_average_known_windows() {
    let scores = vec![10.0, 20.0, 30.0, 40.0, 50.0];
    let ma = velocity_moving_average(&scores, 3);
    assert_eq!(ma, vec![20.0, 30.0, 40.0]);
    // window longer than the series yields empty (guards a slice panic)
    assert!(velocity_moving_average(&scores, 99).is_empty());
    // window of 0 yields empty (guards a div-by-zero)
    assert!(velocity_moving_average(&scores, 0).is_empty());
}

#[test]
fn moving_average_window_equal_to_len_is_single_mean() {
    let scores = vec![2.0, 4.0, 6.0];
    let ma = velocity_moving_average(&scores, 3);
    assert_eq!(ma, vec![4.0]); // (2+4+6)/3
}

// ---------------------------------------------------------------------------
// SCALE-MISMATCH regression guard — the heart of the money/math path
// ---------------------------------------------------------------------------

/// Bridge the [0,1] composite score onto the 0..100 scale the classifier
/// and guardrails expect. This is the missing glue between
/// `calculate_velocity_score` and `classify_velocity` / `should_auto_execute`.
fn velocity_score_scaled(aph: f64, sr: f64, art: f64) -> f64 {
    calculate_velocity_score(aph, sr, art) * 100.0
}

#[test]
fn raw_score_fed_to_classifier_is_the_known_trap() {
    // Document the bug: a MAXED-OUT raw score (1.0) classifies as Cold and
    // never auto-executes, because 1.0 < 40 on the classifier's 0..100 scale.
    let raw = calculate_velocity_score(100.0, 1.0, 0.0); // == 1.0
    assert_eq!(
        classify_velocity(raw),
        VelocityTier::Cold,
        "raw [0,1] score must NOT be passed straight to the 0..100 classifier"
    );
    assert!(
        !should_auto_execute(raw, 0.0),
        "raw score 1.0 wrongly fails the >=70 gate — never wire it directly"
    );
}

#[test]
fn scaled_bridge_produces_intended_tiers() {
    // Perfect signal, correctly scaled -> 100.0 -> Critical, auto-executes.
    let top = velocity_score_scaled(100.0, 1.0, 0.0);
    assert!((top - 100.0).abs() < EPS, "got {top}");
    assert_eq!(classify_velocity(top), VelocityTier::Critical);
    assert!(should_auto_execute(top, 0.2));

    // Moderate signal: 0.64 -> 64.0 -> Hot, but auto-execute blocked (<70).
    let mid = velocity_score_scaled(50.0, 0.8, 30.0);
    assert!((mid - 64.0).abs() < EPS, "got {mid}");
    assert_eq!(classify_velocity(mid), VelocityTier::Hot);
    assert!(!should_auto_execute(mid, 0.2), "64 < 70 must not auto-execute");

    // Strong signal at exactly the 70 auto-execute boundary.
    // Need score == 70: aph 100 (0.40), success 1.0 (0.30) -> 0.70 -> 70.0
    let boundary = velocity_score_scaled(100.0, 1.0, 1.0e15);
    assert!((boundary - 70.0).abs() < 1e-3, "got {boundary}");
    assert!(should_auto_execute(boundary, 0.2));
    assert_eq!(classify_velocity(boundary), VelocityTier::Hot);
}

// ---------------------------------------------------------------------------
// Escalation priority & oversight — ordering money-decision lanes
// ---------------------------------------------------------------------------

fn lane(id: &str, mode: EscalationMode, evidence: usize, guardrail: &str) -> EscalationLane {
    let mut l = EscalationLane::new(id, "lane", mode, guardrail, "owner");
    l.evidence = (0..evidence).map(|i| format!("e{i}")).collect();
    l
}

#[test]
fn classify_escalation_precedence_evidence_over_guardrail() {
    // 3+ evidence wins even if the guardrail is a known approval pattern.
    let l = lane("A", EscalationMode::HumanHandoff, 3, "spending_cap");
    assert_eq!(classify_escalation(&l), EscalationMode::Autonomous);

    // Known guardrail with <3 evidence -> ApprovalRequired.
    let l = lane("B", EscalationMode::Autonomous, 2, "spending_cap");
    assert_eq!(classify_escalation(&l), EscalationMode::ApprovalRequired);

    // Unknown guardrail, low evidence -> HumanHandoff (safest default).
    let l = lane("C", EscalationMode::Autonomous, 0, "mystery_rule");
    assert_eq!(classify_escalation(&l), EscalationMode::HumanHandoff);
}

#[test]
fn escalation_priority_evidence_bonus_caps_at_three() {
    // HumanHandoff base 3 + min(evidence,3).
    assert_eq!(escalation_priority(&lane("A", EscalationMode::HumanHandoff, 0, "x")), 3);
    assert_eq!(escalation_priority(&lane("A", EscalationMode::HumanHandoff, 3, "x")), 6);
    assert_eq!(
        escalation_priority(&lane("A", EscalationMode::HumanHandoff, 100, "x")),
        6,
        "evidence bonus must cap at +3 (no u8 overflow / runaway priority)"
    );
}

#[test]
fn lanes_sorted_highest_priority_first() {
    let lanes = vec![
        lane("auto", EscalationMode::Autonomous, 0, "x"),       // 1
        lane("handoff", EscalationMode::HumanHandoff, 2, "x"),  // 3+2=5
        lane("approve", EscalationMode::ApprovalRequired, 1, "x"), // 2+1=3
    ];
    let sorted = lanes_by_priority(&lanes);
    assert_eq!(sorted[0].id, "handoff");
    assert_eq!(sorted[2].id, "auto");
}

#[test]
fn human_oversight_ratio_known_values() {
    let mut s = EscalationSummary::zero();
    s.total = 8;
    s.approval_required = 3;
    s.human_handoff = 1;
    // (3+1)/8 = 0.5
    assert!((human_oversight_ratio(&s) - 0.5).abs() < EPS);

    // empty summary must not divide by zero
    assert!((human_oversight_ratio(&EscalationSummary::zero()) - 0.0).abs() < EPS);
}
