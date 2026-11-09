using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// The free game's Stone Hall, puzzle 2 — the rune chain ("שרשרת הרונים"): the disc on the wall lights its symbols in an
/// order, and the group repeats it on the four rune stones. Three stages (2, 3, then all 4 symbols); in the second, one
/// light comes "in the dark" — nobody sees it except one player, who holds it as a private clue and has to tell the rest.
/// Only scenarios with a "runechain" puzzle reach this code (the Last Portal's "sequence" puzzles are answers, not this).
/// </summary>
public sealed partial class GameEngine
{
    /// <summary>Seconds between two lights of a stage: slower once the group has gone wrong a few times.</summary>
    public static double SequenceStep(JsonObject data, int misses) =>
        misses >= (data["slowAfter"]?.GetValue<int>() ?? 3) ? data["slowStepSeconds"]?.GetValue<double>() ?? 1.4 : data["stepSeconds"]?.GetValue<double>() ?? 0.9;

    /// <summary>When the lights of the stage that started at <paramref name="started"/> have all been shown.</summary>
    /// The light in the dark stays on longer (darkHoldSeconds more), so the one who sees it can tell which symbol it was.
    public static DateTime SequenceShowEnd(JsonObject data, DateTime started, int length, int misses, bool dark = false) =>
        started.AddSeconds((data["leadSeconds"]?.GetValue<double>() ?? 0.8) + length * SequenceStep(data, misses)
            + (dark ? data["darkHoldSeconds"]?.GetValue<double>() ?? 0 : 0));

    /// <summary>The stage's sequence as everyone may see it: a symbol shown in the dark is "?".</summary>
    private static List<string> PublicStage(PuzzleContent puzzle, int stage)
    {
        var seq = puzzle.Solution["stages"]![stage]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var dark = puzzle.PublicData["stages"]?[stage]?["dark"]?.GetValue<int>();
        return seq.Select((s, i) => i == dark ? "?" : s).ToList();
    }

    private ActionOutcome OperateSequence(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var data = puzzle.PublicData;
        var stages = puzzle.Solution["stages"]!.AsArray();
        var stage = Math.Min(mech.Progress, stages.Count - 1);
        var seq = stages[stage]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var symbols = data["symbols"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        var dark = mech.Shown?.Contains("?") == true;
        var showing = mech.StartedAt is { } s && now < SequenceShowEnd(data, s, seq.Count, mech.Misses, dark);
        var alone = ActivePlayers(room).Count() <= 1;
        var notices = new List<GameNotice>();
        switch (op)
        {
            case "show":
            {
                // a replay waits a moment after the last one ended (everyone watches the same lights)
                var cooldown = data["replaySeconds"]?.GetValue<double>() ?? 1.5;
                if (mech.StartedAt is { } last && now < SequenceShowEnd(data, last, seq.Count, mech.Misses, dark).AddSeconds(cooldown))
                    return ActionOutcome.Fail("showing", showing ? "הרצף מוצג עכשיו — צפו בו עד הסוף." : "רגע אחד — אפשר להציג שוב בעוד שנייה.");
                mech.StartedAt = now;
                mech.Shown = PublicStage(puzzle, stage);
                mech.Input = [];
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                notices.Add(new("sequence-show", $"{player.Nickname} הציג את רצף הסמלים — שלב {stage + 1}", player.Id.ToString(), puzzle.Id));
                if (mech.Shown.Contains("?"))
                    notices.Add(new("sequence-dark", alone ? "אחד האורות נדלק בחושך — זכרו את הסמל שהאיר." : "אחד האורות נדלק בחושך — רק אחד מכם ראה מה הוא היה.", PuzzleId: puzzle.Id));
                return new ActionOutcome(true, "showing", "צפו בסדר שבו הסמלים נדלקים.", notices, true);
            }
            case "press":
            {
                var symbol = action.TryGetProperty("symbol", out var v) && v.ValueKind == JsonValueKind.String ? v.GetString()! : "";
                if (!symbols.Contains(symbol)) return ActionOutcome.Fail("bad-symbol", "האבן הזאת לא קיימת.");
                if (mech.StartedAt == null) return ActionOutcome.Fail("not-shown", "לחצו קודם „הצגת הרצף” וצפו בסדר שבו הסמלים נדלקים.");
                if (showing) return ActionOutcome.Fail("showing", "חכו שהרצף יסתיים, ואז געו באבנים לפי הסדר.");
                mech.Input ??= [];
                mech.Input.Add(symbol);
                Contribute(world, player.Id);
                var k = mech.Input.Count - 1;
                if (mech.Input[k] != seq[k])
                {
                    mech.Misses++;
                    mech.Input = [];
                    state.Attempts++;
                    SaveWorld(room, world, now);
                    var msg = "הסדר שגוי — האבנים מהבהבות באדום והרצף התאפס. אפשר לצפות שוב ברצף ולנסות שוב.";
                    if (mech.Misses == (data["slowAfter"]?.GetValue<int>() ?? 3)) msg += " מעכשיו הרצף יוצג לאט יותר.";
                    return new ActionOutcome(true, "wrong", msg,
                        [new("sequence-wrong", $"{player.Nickname} נגע באבן — הסדר שגוי, הרצף התאפס", player.Id.ToString(), puzzle.Id)], true);
                }
                if (mech.Input.Count < seq.Count)
                {
                    SaveWorld(room, world, now);
                    return new ActionOutcome(true, "pressed", "", [], true);
                }
                // the stage is complete: it counts for the player who finished it
                notices.Add(new("sequence-stage", $"{player.Nickname} השלים את שלב {stage + 1} של שרשרת הרונים", player.Id.ToString(), puzzle.Id));
                mech.Progress++;
                Award(world, scenario, $"stage:{puzzle.Id}:{mech.Progress}", player, scenario.Scoring?.Stage ?? 0, "stage",
                    $"שרשרת הרונים — שלב {mech.Progress}", puzzle.Zone, puzzle.Id, now, notices);
                if (mech.Progress >= stages.Count)
                {
                    mech.Input = [.. seq];
                    SaveWorld(room, world, now);
                    return Solve(room, scenario, puzzle, state, player, now, notices);
                }
                // the next stage plays by itself a moment later
                mech.Input = [];
                mech.StartedAt = now.AddSeconds(data["nextStageSeconds"]?.GetValue<double>() ?? 1.6);
                mech.Shown = PublicStage(puzzle, mech.Progress);
                if (mech.Shown.Contains("?"))
                    notices.Add(new("sequence-dark", alone ? "בשלב הזה אחד האורות נדלק בחושך — זכרו את הסמל שהאיר." : "בשלב הזה אחד האורות נדלק בחושך — רק אחד מכם יראה מה הוא היה. שתפו!", PuzzleId: puzzle.Id));
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "stage", mech.Progress == stages.Count - 1
                    ? "נכון! עכשיו הרצף המלא — ארבעת הסמלים."
                    : $"נכון! שלב {mech.Progress + 1}: הפעם {stages[mech.Progress]!.AsArray().Count} סמלים.", notices, true);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }
}
