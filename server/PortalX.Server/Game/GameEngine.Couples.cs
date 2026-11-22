using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// "הצופן הזוגי" — the mechanisms only this game has. Only scenarios with these puzzle data reach this code:
///   compass + "hands" — the broken clock: two hands turned one by one over the symbols, checked together;
///   bridge            — the swaying bridge: two halves on a middle pivot, each with its lever and its latch; the ball rolls
///                       by rules judged here (slope, a steep half, the joint, the container), never by the client;
///   build             — building the home: stages of sockets filled with the collected parts and look-alike decoys, each
///                       part turned to its side; a stage is checked as a whole and never says which part is wrong.
/// </summary>
public sealed partial class GameEngine
{
    // ---------------------------------------------------------------- the broken clock (compass with hands)

    private static int Int(JsonElement action, string name, int fallback = -1) =>
        action.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : fallback;

    private static string? Str(JsonElement action, string name) =>
        action.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static List<int> ClockStart(PuzzleContent puzzle)
    {
        var hands = puzzle.PublicData["hands"]!.GetValue<int>();
        var start = puzzle.PublicData["start"]?.AsArray().Select(n => n!.GetValue<int>()).ToList() ?? new();
        return Enumerable.Range(0, hands).Select(k => k < start.Count ? start[k] : 0).ToList();
    }

    private ActionOutcome OperateClockHands(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var marks = puzzle.PublicData["marks"]!.AsArray();
        var handLabels = puzzle.PublicData["handLabels"]?.AsArray().Select(n => n!.GetValue<string>()).ToList() ?? new();
        if (mech.Rotations.Count == 0) mech.Rotations = ClockStart(puzzle);
        if (state.Status == PuzzleStatus.Solved) return ActionOutcome.Fail("already-solved", puzzle.PublicData["solvedMessage"]?.GetValue<string>() ?? "המנגנון כבר נפתח.");
        var pid = player.Id.ToString();
        switch (op)
        {
            case "turn":
            {
                var k = Int(action, "hand");
                if (k < 0 || k >= mech.Rotations.Count) return ActionOutcome.Fail("bad-hand", "המחוג הזה לא קיים.");
                var dir = Int(action, "dir", 1) < 0 ? -1 : 1;
                mech.Rotations[k] = ((mech.Rotations[k] + dir) % marks.Count + marks.Count) % marks.Count;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                var hand = k < handLabels.Count ? handLabels[k] : $"מחוג {k + 1}";
                var at = marks[mech.Rotations[k]]!["label"]!.GetValue<string>();
                return new ActionOutcome(true, "turned", $"{hand} מצביע על {at}",
                    [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: סובב את {hand} אל {at}", pid, puzzle.Id)], true);
            }
            case "press":
            {
                var targets = puzzle.Solution["targets"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
                var right = targets.Select((t, k) => marks[mech.Rotations[k]]!["id"]!.GetValue<string>() == t).All(x => x);
                if (!right)
                {
                    var msg = WrongCode(state, now, puzzle.Failure);
                    SaveWorld(room, world, now);
                    return new ActionOutcome(false, "wrong-answer", msg, [new("wrong-answer", $"{player.Nickname} · {puzzle.Title}: {puzzle.Failure}", pid, puzzle.Id)], true);
                }
                state.Attempts++;
                mech.Ready = true;
                mech.StartedAt = now;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return Solve(room, scenario, puzzle, state, player, now);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- the swaying bridge

    /// <summary>The outcome of one release of the ball, for the client to animate: the stations it passed and how it ended.</summary>
    public sealed record BridgeRoll(List<int> Path, string End);

    /// <summary>
    /// Rolls the ball from <paramref name="at"/> with the halves at angles <paramref name="l"/> and <paramref name="r"/>
    /// (positive = the half slopes down to the right). Stations 0..container; the joint is the pivot between the halves.
    /// Ends: "stuck" (no slope), "rest" (stopped at a station), "steep" / "joint" / "bounced" (the ball fell), "container".
    /// </summary>
    public static BridgeRoll RollBall(JsonObject data, int at, int l, int r)
    {
        int joint = data["joint"]!.GetValue<int>(), container = data["stations"]!.GetValue<int>();
        int tol = data["jointTolerance"]?.GetValue<int>() ?? 1, steep = data["steep"]?.GetValue<int>() ?? 3;
        int maxIn = data["containerMaxSpeed"]?.GetValue<int>() ?? 1;
        int Slope(int p) => p < joint ? l : p > joint ? r : r > 0 ? r : l < 0 ? l : 0;
        var path = new List<int> { at };
        var a = Slope(at);
        if (a == 0 || (at == 0 && a < 0)) return new(path, "stuck");
        if (Math.Abs(a) >= steep) return new(path, "steep");
        int dir = Math.Sign(a), speed = Math.Abs(a), p = at;
        for (var step = 0; step < speed; step++)
        {
            p += dir;
            if (p < 0) break;
            path.Add(p);
            if (p == joint && Math.Abs(l - r) > tol) return new(path, "joint");
            if (p >= container) return new(path, speed > maxIn ? "bounced" : "container");
            // the half the ball would roll on next: uphill (or flat) stops it here, too steep throws it off
            var ahead = dir > 0 ? (p >= joint ? r : l) : (p <= joint ? l : r);
            if (Math.Sign(ahead) != dir) break;
            if (Math.Abs(ahead) >= steep) return new(path, "steep");
        }
        return new(path, "rest");
    }

    private ActionOutcome OperateBridge(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var data = puzzle.PublicData;
        int min = data["min"]!.GetValue<int>(), max = data["max"]!.GetValue<int>(), joint = data["joint"]!.GetValue<int>();
        int tol = data["jointTolerance"]?.GetValue<int>() ?? 1;
        var coupled = data["coupled"]?.GetValue<bool>() == true;
        var sides = data["sides"]!.AsArray().Select(n => n!["label"]!.GetValue<string>()).ToList();
        var pid = player.Id.ToString();
        string Text(string key, string fallback) => data[key]?.GetValue<string>() ?? fallback;

        ActionOutcome Fall(string why, List<int> path)
        {
            mech.Progress = 0;
            mech.Misses++;
            mech.Found = path.Select(x => x.ToString()).ToList();
            mech.Revealed = why;
            mech.StartedAt = now;
            var msg = WrongCode(state, now, Text(why + "Message", puzzle.Failure));
            SaveWorld(room, world, now);
            return new ActionOutcome(false, "fell", msg, [new("bridge-fell", $"{player.Nickname} · {puzzle.Title}: {Text(why + "Message", puzzle.Failure)}", pid, puzzle.Id)], true);
        }

        switch (op)
        {
            case "tilt":
            {
                var side = Int(action, "side");
                if (side is not (0 or 1)) return ActionOutcome.Fail("bad-side", "הצד הזה לא קיים.");
                var d = Int(action, "dir", 1) < 0 ? -1 : 1;
                var other = 1 - side;
                var next = mech.Rotations[side] + d;
                if (next < min || next > max) return ActionOutcome.Fail("end", $"{sides[side]} כבר בקצה.");
                // a seesaw: the free half moves the other way, unless its latch holds it
                var moveOther = coupled && !mech.Levers[other];
                if (moveOther && (mech.Rotations[other] - d < min || mech.Rotations[other] - d > max))
                    return ActionOutcome.Fail("end", $"{sides[other]} כבר בקצה — נעלו אותו כדי להזיז רק את {sides[side]}.");
                if (mech.Levers[side]) return ActionOutcome.Fail("latched", $"{sides[side]} נעול. שחררו את הבריח כדי להזיז אותו.");
                mech.Rotations[side] = next;
                if (moveOther) mech.Rotations[other] -= d;
                mech.Revealed = null;
                mech.Found.Clear();
                Contribute(world, player.Id);
                // the ball sitting on the joint falls when the two halves part too far (the bridge is unstable)
                if (mech.Progress == joint && Math.Abs(mech.Rotations[0] - mech.Rotations[1]) > tol)
                    return Fall("joint", [joint]);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "tilted", "", [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: הזיז את {sides[side]}", pid, puzzle.Id)], true);
            }
            case "latch":
            {
                var side = Int(action, "side");
                if (side is not (0 or 1)) return ActionOutcome.Fail("bad-side", "הצד הזה לא קיים.");
                mech.Levers[side] = !mech.Levers[side];
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                var text = mech.Levers[side] ? $"נעל את {sides[side]}" : $"שחרר את {sides[side]}";
                return new ActionOutcome(true, "latched", "", [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: {text}", pid, puzzle.Id)], true);
            }
            case "release":
            {
                var roll = RollBall(data, mech.Progress, mech.Rotations[0], mech.Rotations[1]);
                Contribute(world, player.Id);
                if (roll.End is "steep" or "joint" or "bounced") return Fall(roll.End, roll.Path);
                mech.Found = roll.Path.Select(x => x.ToString()).ToList();
                mech.Revealed = roll.End;
                mech.StartedAt = now;
                if (roll.End == "stuck")
                {
                    SaveWorld(room, world, now);
                    return new ActionOutcome(false, "stuck", Text("stuckMessage", "הכדור לא זז."), [], true);
                }
                mech.Progress = roll.Path[^1];
                if (roll.End == "container")
                {
                    state.Attempts++;
                    state.WrongStreak = 0;
                    mech.Ready = true;
                    SaveWorld(room, world, now);
                    return Solve(room, scenario, puzzle, state, player, now);
                }
                var rolled = new List<GameNotice> { new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: שחרר את הכדור", pid, puzzle.Id) };
                Award(world, scenario, $"stage:{puzzle.Id}:{mech.Progress}", player, scenario.Scoring?.Stage ?? 0, "stage", "הכדור התקדם על הגשר", puzzle.Zone, puzzle.Id, now, rolled);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "rolled", "", rolled, true);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- building the home

    private static List<(string Id, List<string> Sockets)> BuildStages(PuzzleContent p) =>
        p.PublicData["stages"]!.AsArray().Select(s => (s!["id"]!.GetValue<string>(),
            s["sockets"]!.AsArray().Select(k => k!["id"]!.GetValue<string>()).ToList())).ToList();

    private ActionOutcome OperateBuild(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var stages = BuildStages(puzzle);
        var accepts = puzzle.PublicData["accepts"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();
        var turning = puzzle.PublicData["rotatable"]?.AsArray().Select(n => n!.GetValue<string>()).ToHashSet() ?? new();
        var pid = player.Id.ToString();
        if (mech.Progress >= stages.Count) return ActionOutcome.Fail("built", "הבית כבר בנוי.");
        var (stageId, current) = stages[mech.Progress];
        string ItemName(string id) => scenario.Item(id)?.Name ?? id;
        // where a part goes back: the room's table for the parts that lie in this room, the bag for the rest
        void Return(string item)
        {
            var it = scenario.Item(item);
            if (it != null && it.Zone == puzzle.Zone && it.SpawnedAtStart) { if (!world.WorldItems.Contains(item)) world.WorldItems.Add(item); }
            else if (!world.Inventory.Contains(item)) world.Inventory.Add(item);
        }
        var socket = Str(action, "socket") ?? "";
        switch (op)
        {
            case "place":
            {
                if (!current.Contains(socket)) return ActionOutcome.Fail("bad-socket", stages.Any(s => s.Sockets.Contains(socket))
                    ? "זה עוד לא השלב הזה של הבנייה." : "המקום הזה לא קיים.");
                if (mech.Slots.ContainsKey(socket)) return ActionOutcome.Fail("slot-taken", "המקום הזה כבר תפוס. הרימו קודם את מה שמונח בו.");
                var item = Str(action, "item") ?? "";
                if (!accepts.Contains(item)) return ActionOutcome.Fail("not-fitting", "החלק הזה לא שייך לבית.");
                if (!world.Inventory.Remove(item) && !world.WorldItems.Remove(item)) return ActionOutcome.Fail("item-missing", "החלק הזה לא נמצא בתיק או על השולחן.");
                mech.Slots[socket] = item;
                mech.Backs[socket] = "0";
                mech.SlotBy[socket] = pid;
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "placed", "", [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: הניח את {ItemName(item)}", pid, puzzle.Id)], true);
            }
            case "turn":
            {
                if (!current.Contains(socket) || !mech.Slots.TryGetValue(socket, out var item)) return ActionOutcome.Fail("slot-empty", "אין כאן חלק לסובב.");
                if (!turning.Contains(item)) return ActionOutcome.Fail("fixed", "את החלק הזה אי אפשר לסובב.");
                mech.Backs[socket] = ((int.Parse(mech.Backs.GetValueOrDefault(socket, "0")) + 1) % 4).ToString();
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "turned", "", [], true);
            }
            case "remove":
            {
                if (!current.Contains(socket) || !mech.Slots.TryGetValue(socket, out var item)) return ActionOutcome.Fail("slot-empty", "המקום הזה ריק.");
                mech.Slots.Remove(socket);
                mech.Backs.Remove(socket);
                mech.SlotBy.Remove(socket);
                Return(item);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "removed", "", [], true);
            }
            case "check":
            {
                var missing = current.Count(s => !mech.Slots.ContainsKey(s));
                if (missing > 0) return ActionOutcome.Fail("not-ready", missing == 1 ? "חסר עוד חלק אחד בשלב הזה." : $"חסרים עוד {missing} חלקים בשלב הזה.");
                var want = puzzle.Solution[stageId]!.AsObject();
                bool Right(string s)
                {
                    var spec = want[s]!.GetValue<string>().Split('@');
                    if (mech.Slots[s] != spec[0]) return false;
                    return spec.Length < 2 || mech.Backs.GetValueOrDefault(s, "0") == spec[1];
                }
                Contribute(world, player.Id);
                if (!current.All(Right))
                {
                    var msg = WrongCode(state, now, puzzle.Failure);
                    SaveWorld(room, world, now);
                    return new ActionOutcome(false, "wrong-answer", msg, [new("wrong-answer", $"{player.Nickname} · {puzzle.Title}: {puzzle.Failure}", pid, puzzle.Id)], true);
                }
                state.WrongStreak = 0;
                var notices = new List<GameNotice>();
                foreach (var s in current)
                {
                    mech.Verdict[s] = true;
                    var placer = Guid.TryParse(mech.SlotBy.GetValueOrDefault(s), out var g) ? FindPlayer(room, g) : null;
                    if (placer != null)
                        Award(world, scenario, $"placement:{puzzle.Id}:{s}", placer, puzzle.Score?.Placement ?? scenario.Scoring?.Placement ?? 0, "placement",
                            "חלק הורכב במקום הנכון", puzzle.Zone, puzzle.Id, now, notices);
                }
                mech.Progress++;
                mech.StartedAt = now;
                var label = puzzle.PublicData["stages"]![mech.Progress - 1]!["label"]!.GetValue<string>();
                if (mech.Progress < stages.Count)
                {
                    Award(world, scenario, $"stage:{puzzle.Id}:{stageId}", player, scenario.Scoring?.Stage ?? 0, "stage", $"שלב „{label}” הושלם", puzzle.Zone, puzzle.Id, now, notices);
                    notices.Add(new("build-stage", $"{player.Nickname} · {puzzle.Title}: שלב „{label}” הושלם", pid, puzzle.Id));
                    SaveWorld(room, world, now);
                    return new ActionOutcome(true, "stage", label, notices, true);
                }
                state.Attempts++;
                mech.Ready = true;
                SaveWorld(room, world, now);
                return Solve(room, scenario, puzzle, state, player, now, notices);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- the ball track (pipes with checkpoints)

    /// <summary>True when the scenario asks for no checkpoints, or the flow passed every one of them.</summary>
    public static bool PipeCheckpoints(JsonObject data, IReadOnlyCollection<string> cells) =>
        data["checkpoints"]?.AsArray().All(n => cells.Contains(n!.GetValue<string>())) ?? true;
}
