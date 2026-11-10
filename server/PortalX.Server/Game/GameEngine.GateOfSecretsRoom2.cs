using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// The free game "שער הסודות", room 2 — the ancient mechanisms, and the end. Only scenarios with these puzzle types reach
/// this code (no paid game has them):
///   pipes    — a grid of pipe pieces between the water source and the central tank: some turn, some are fixed (one is
///              cracked — a dead end). The drain valve must be shut before the main valve is opened; then the water runs
///              along the pipes as they lie now, and fills the tank only through an unbroken path. Judged here, every time.
///   finalkey — the end, not a puzzle: once both mechanisms run, the golden key from room 1 turns in the gate's lock.
/// The hidden weights between the two are an ordinary "checkWhole" arrangement (GameEngine.GateOfSecrets.cs).
/// </summary>
public sealed partial class GameEngine
{
    // ---------------------------------------------------------------- the ancient pipes

    /// <summary>Sides of a cell: north, east, south, west (a quarter turn moves each one to the next).</summary>
    private static readonly (int Dr, int Dc)[] Step = [(-1, 0), (0, 1), (1, 0), (0, -1)];

    /// <summary>The sides a piece joins, as it lies: a straight pipe (S) joins two opposite sides, an elbow (L) two neighbours.</summary>
    public static int[] PipeSides(char kind, int turns) => kind switch
    {
        'S' => turns % 2 == 0 ? [1, 3] : [0, 2],
        'L' => [turns % 4, (turns + 1) % 4],
        _ => [],
    };

    private static List<string> PipeRows(JsonObject data) => data["tiles"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();

    /// <summary>The quarter turns every piece starts with, row by row.</summary>
    public static List<int> PipeStart(JsonObject data) => data["start"]!.AsArray().SelectMany(row => row!.AsArray().Select(n => n!.GetValue<int>())).ToList();

    /// <summary>Whether the piece at this index can be turned by the players (the others are fixed in the wall).</summary>
    public static bool PipeTurns(JsonObject data, int index)
    {
        var cols = PipeRows(data)[0].Length;
        return data["turnable"]!.AsArray().Any(n => n!.GetValue<string>() == $"{index / cols},{index % cols}");
    }

    /// <summary>
    /// Where the water goes from the source, through the pieces as they lie: the cells it fills, in order, and whether it
    /// reaches the tank. It stops where a piece does not take it (or at the edge) — that is the leak the players see.
    /// </summary>
    public static (List<string> Cells, bool Reached) PipeFlow(JsonObject data, IReadOnlyList<int> turns)
    {
        var rows = PipeRows(data);
        int h = rows.Count, w = rows[0].Length;
        var r = data["source"]!["row"]!.GetValue<int>();
        var c = 0;
        var entry = 3;   // the water comes in from the west
        int tankRow = data["tank"]!["row"]!.GetValue<int>(), tankCol = data["tank"]!["col"]!.GetValue<int>();
        var cells = new List<string>();
        for (var guard = 0; guard < h * w + 1; guard++)
        {
            if (r < 0 || r >= h || c < 0 || c >= w) return (cells, false);
            var sides = PipeSides(rows[r][c], turns[r * w + c]);
            if (!sides.Contains(entry)) return (cells, false);
            var key = $"{r},{c}";
            if (cells.Contains(key)) return (cells, false);
            cells.Add(key);
            var exit = sides[0] == entry ? sides[1] : sides[0];
            // the tank's inlet: out of the last piece through its east side
            if (r == tankRow && c == tankCol && exit == 1) return (cells, true);
            r += Step[exit].Dr;
            c += Step[exit].Dc;
            entry = (exit + 2) % 4;
        }
        return (cells, false);
    }

    private ActionOutcome OperatePipes(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var data = puzzle.PublicData;
        var pid = player.Id.ToString();
        // Levers: [the main valve is open, the drain valve is open]
        switch (op)
        {
            case "rotate":
            {
                var i = action.GetProperty("index").GetInt32();
                if (i < 0 || i >= mech.Rotations.Count) return ActionOutcome.Fail("bad-action", "הצינור הזה לא קיים.");
                if (!PipeTurns(data, i)) return ActionOutcome.Fail("fixed", "הצינור הזה מקובע לקיר ואי אפשר לסובב אותו.");
                var grid = PipeRows(data);
                var kind = grid[i / grid[0].Length][i % grid[0].Length];
                mech.Rotations[i] = (mech.Rotations[i] + 1) % (kind == 'S' ? 2 : 4);
                // a turned pipe dries: the last flow is over
                mech.Found.Clear();
                Contribute(world, player.Id);
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "rotated", "הצינור הסתובב",
                    [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: סובב צינור", pid, puzzle.Id)], true);
            }
            case "valve":
            {
                var which = action.GetProperty("id").GetString();
                if (which == "drain")
                {
                    mech.Levers[1] = !mech.Levers[1];
                    Contribute(world, player.Id);
                    SaveWorld(room, world, now);
                    var text = mech.Levers[1] ? "ברז הניקוז נפתח" : "ברז הניקוז נסגר";
                    return new ActionOutcome(true, "valve", text, [new("puzzle-action", $"{player.Nickname} · {puzzle.Title}: {text}", pid, puzzle.Id)], true);
                }
                if (which != "main") return ActionOutcome.Fail("bad-action", "הברז הזה לא קיים.");
                state.Attempts++;
                mech.StartedAt = now;
                Contribute(world, player.Id);
                if (mech.Levers[1])
                {
                    // the water runs straight out through the open drain: nothing reaches the pipes
                    mech.Found.Clear();
                    SaveWorld(room, world, now);
                    var drained = data["drainMessage"]!.GetValue<string>();
                    return new ActionOutcome(false, "drained", drained, [new("wrong-answer", $"{player.Nickname} · {puzzle.Title}: {drained}", pid, puzzle.Id)], true);
                }
                var (cells, reached) = PipeFlow(data, mech.Rotations);
                mech.Found = cells;
                if (!reached)
                {
                    SaveWorld(room, world, now);
                    return new ActionOutcome(false, "leaked", puzzle.Failure, [new("wrong-answer", $"{player.Nickname} · {puzzle.Title}: {puzzle.Failure}", pid, puzzle.Id)], true);
                }
                mech.Levers[0] = true;
                mech.Ready = true;
                SaveWorld(room, world, now);
                return Solve(room, scenario, puzzle, state, player, now);
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---------------------------------------------------------------- the end: the golden key in the gate

    private ActionOutcome OperateFinalKey(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, string op, DateTime now)
    {
        if (op != "use") return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        var key = puzzle.PublicData["needsItem"]!.GetValue<string>();
        if (!world.Inventory.Contains(key)) return ActionOutcome.Fail("item-missing", $"{scenario.Item(key)?.Name ?? "המפתח"} לא נמצא בתיק.");
        // the key stays in the lock
        world.Inventory.Remove(key);
        state.Attempts++;
        Contribute(world, player.Id);
        SaveWorld(room, world, now);
        return Solve(room, scenario, puzzle, state, player, now,
            [new("gate-key", $"{player.Nickname} הכניס את {scenario.Item(key)?.Name ?? "המפתח"} למנעול השער וסובב אותו", player.Id.ToString(), puzzle.Id)]);
    }

    /// <summary>The end of the game is not one of its puzzles: it is left out of "solved X of Y".</summary>
    public static bool IsFinale(PuzzleContent p) => p.PublicData["finale"]?.GetValue<bool>() == true;
}
