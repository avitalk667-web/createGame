using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// The free game's Stone Hall ("שער הסודות" 2.0, room 1): the crystal pendulum and the map assembled from its pieces.
/// Only scenarios that define a "pendulum" or "assembly" puzzle reach this code.
/// </summary>
public sealed partial class GameEngine
{
    // ---------------------------------------------------------------- pendulum: stop the swing in the target zone

    /// <summary>
    /// The swing's angle (degrees, 0 = straight down) <paramref name="seconds"/> after a round started. The same formula
    /// runs in the browser to draw the swing (h-world.ts pendulumAngle); the server decides every stop with it.
    ///   steady  — a slow, even swing (the first round teaches the timing)
    ///   varying — the pace drifts faster and slower (watch the swing, not a rhythm)
    ///   pause   — once every swing it halts for a moment on its way down, then goes on (do not press on the halt)
    /// </summary>
    public static double PendulumAngle(JsonNode round, double seconds)
    {
        var kind = round["kind"]?.GetValue<string>() ?? "steady";
        var period = round["period"]!.GetValue<double>();
        var amplitude = round["amplitude"]!.GetValue<double>();
        var t = Math.Max(0, seconds);
        double phase;
        switch (kind)
        {
            case "varying":
                // the phase still always moves forward (vary < 2.7), so the swing never runs backwards
                var vary = round["vary"]?.GetValue<double>() ?? 0.9;
                phase = 2 * Math.PI * t / period + vary * Math.Sin(2 * Math.PI * t / (2.7 * period));
                break;
            case "pause":
                var hold = round["pauseSeconds"]?.GetValue<double>() ?? 0.45;
                var at = (round["pauseAt"]?.GetValue<double>() ?? 0.4) * period;
                var cycle = period + hold;
                var n = Math.Floor(t / cycle);
                var u = t - n * cycle;
                var tau = n * period + (u < at ? u : u < at + hold ? at : u - hold);
                phase = 2 * Math.PI * tau / period;
                break;
            default:
                phase = 2 * Math.PI * t / period;
                break;
        }
        return amplitude * Math.Sin(phase);
    }

    /// <summary>The half-width of the target zone in degrees: wider once the group has missed a few times.</summary>
    public static double PendulumWindow(JsonObject data, int misses) =>
        misses >= (data["widenAfter"]?.GetValue<int>() ?? 3)
            ? data["widenedWindow"]?.GetValue<double>() ?? 12
            : data["window"]?.GetValue<double>() ?? 7;

    /// <summary>
    /// When a press happened, on the server's clock. The browser sends the moment the player pressed (its estimate of the
    /// server's time, from the clock it keeps in step with the snapshots) and its measured round trip. The server accepts
    /// a moment only in the recent past — at most half the round trip plus a margin (never more than maxLagMs) — so a slow
    /// phone is judged by when the player really pressed, and nobody can claim a moment long gone. Without a moment, the
    /// press counts a short margin before it arrived.
    /// </summary>
    public static DateTime PendulumPressTime(JsonObject data, JsonElement action, DateTime now)
    {
        var minLag = data["minLagMs"]?.GetValue<double>() ?? 150;
        var maxLag = data["maxLagMs"]?.GetValue<double>() ?? 600;
        double rtt = action.TryGetProperty("rtt", out var r) && r.ValueKind == JsonValueKind.Number ? r.GetDouble() : 0;
        var lag = Math.Clamp(rtt / 2 + minLag, minLag, maxLag);
        if (!action.TryGetProperty("at", out var a) || a.ValueKind != JsonValueKind.Number) return now.AddMilliseconds(-minLag);
        var claimed = DateTime.UnixEpoch.AddMilliseconds(a.GetDouble());
        var earliest = now.AddMilliseconds(-lag);
        return claimed < earliest ? earliest : claimed > now ? now : claimed;
    }

    private ActionOutcome OperatePendulum(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var data = puzzle.PublicData;
        var rounds = data["rounds"]!.AsArray();
        var round = Math.Min(mech.Progress, rounds.Count - 1);
        switch (op)
        {
            case "start":
            {
                if (mech.Running) return new ActionOutcome(true, "running", "המטוטלת כבר בתנועה.", [], false);
                mech.Running = true;
                mech.StartedAt = now;
                mech.FrozenAngle = null;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "started", $"המטוטלת יצאה לדרך — סבב {mech.Progress + 1} מתוך {rounds.Count}.",
                    [new("pendulum-start", $"{player.Nickname} הפעיל את המטוטלת", player.Id.ToString(), puzzle.Id)], true);
            }
            case "freeze":
            {
                if (!mech.Running || mech.StartedAt is not { } started)
                    return ActionOutcome.Fail("not-running", "המטוטלת עומדת. לחצו קודם „הפעלה”.");
                var pressed = PendulumPressTime(data, action, now);
                var angle = PendulumAngle(rounds[round]!, (pressed - started).TotalSeconds);
                var window = PendulumWindow(data, mech.Misses);
                Contribute(world, player.Id);
                if (Math.Abs(angle) > window)
                {
                    mech.Misses++;
                    SaveWorld(room, world, now);
                    var widened = mech.Misses == (data["widenAfter"]?.GetValue<int>() ?? 3);
                    // early or late: was the swing still coming toward the middle, or already moving away from it?
                    var t = (pressed - started).TotalSeconds;
                    var coming = Math.Sign(PendulumAngle(rounds[round]!, t + 0.02) - angle) == -Math.Sign(angle);
                    var msg = coming ? "מוקדם מדי — המטוטלת עוד לא הגיעה לאזור המסומן." : "מאוחר מדי — המטוטלת כבר עברה את האזור המסומן.";
                    if (widened) msg += " האזור המסומן התרחב — עכשיו קל יותר.";
                    return new ActionOutcome(true, "missed", msg,
                        [new("pendulum-miss", $"{player.Nickname} ניסה לעצור את המטוטלת — פספוס", player.Id.ToString(), puzzle.Id)], true,
                        new JsonObject { ["angle"] = Math.Round(angle, 1), ["widened"] = widened });
                }
                mech.Running = false;
                mech.FrozenAngle = Math.Round(angle, 2);
                mech.Progress++;
                var piece = data["pieces"]?.AsArray().ElementAtOrDefault(mech.Progress - 1)?.GetValue<string>();
                var notices = new List<GameNotice> { new("pendulum-hit", $"{player.Nickname} עצר את המטוטלת בדיוק בזמן! חלק מפה השתחרר מהקרח", player.Id.ToString(), puzzle.Id) };
                // every accurate stop counts for the player who made it (once per round), not only the last one
                Award(world, scenario, $"stage:{puzzle.Id}:{mech.Progress}", player, scenario.Scoring?.Stage ?? 0, "stage",
                    $"עצירה מדויקת של המטוטלת — סבב {mech.Progress}", puzzle.Zone, puzzle.Id, now, notices);
                if (mech.Progress >= rounds.Count)
                {
                    state.Attempts++;
                    SaveWorld(room, world, now);
                    return Solve(room, scenario, puzzle, state, player, now, notices);
                }
                SaveWorld(room, world, now);
                var left = rounds.Count - mech.Progress;
                return new ActionOutcome(true, "hit", left == 1
                        ? "בול! חלק מפה השתחרר מהקרח. נותר סבב אחד אחרון — והוא הקשה מכולם."
                        : $"בול! חלק מפה השתחרר מהקרח. נותרו {left} סבבים — כל סבב קשה מעט יותר.",
                    notices, true, new JsonObject { ["angle"] = Math.Round(angle, 1), ["piece"] = piece });
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- assembly: put the torn pieces together

    /// <summary>
    /// Pieces lie in places p1…pn in some order and each is turned by some quarter turns. "swap" exchanges two pieces'
    /// places, "rotate" turns one piece a quarter turn. The puzzle is solved when every piece is in its place and upright.
    /// Mech.Slots holds place → piece; Mech.Rotations the quarter turns of each piece (in the order of publicData.pieces).
    /// </summary>
    private ActionOutcome OperateAssembly(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var pieces = puzzle.PublicData["pieces"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        string? Arg(string name) => action.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        switch (op)
        {
            case "rotate":
            {
                var i = pieces.IndexOf(Arg("piece") ?? "");
                if (i < 0) return ActionOutcome.Fail("bad-piece", "החלק הזה לא קיים.");
                mech.Rotations[i] = (mech.Rotations[i] + 1) % 4;
                break;
            }
            case "swap":
            {
                var a = mech.Slots.FirstOrDefault(kv => kv.Value == Arg("a")).Key;
                var b = mech.Slots.FirstOrDefault(kv => kv.Value == Arg("b")).Key;
                if (a == null || b == null) return ActionOutcome.Fail("bad-piece", "החלק הזה לא קיים.");
                if (a == b) return new ActionOutcome(true, "noop", "", [], false);
                (mech.Slots[a], mech.Slots[b]) = (mech.Slots[b], mech.Slots[a]);
                break;
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
        Contribute(world, player.Id);
        SaveWorld(room, world, now);
        var order = puzzle.Solution["order"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var whole = order.Select((id, k) => mech.Slots.GetValueOrDefault($"p{k + 1}") == id).All(x => x) && mech.Rotations.All(r => r == 0);
        if (!whole) return new ActionOutcome(true, op == "rotate" ? "rotated" : "swapped", "", [], true);
        state.Attempts++;
        return Solve(room, scenario, puzzle, state, player, now);
    }
}
