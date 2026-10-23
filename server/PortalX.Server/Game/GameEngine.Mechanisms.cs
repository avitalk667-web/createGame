using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <summary>
/// Mechanism puzzles with shared state (placement slots, magnetic maze, rotating mosaic), clue discovery and scoring.
/// Used by scenarios that define them (the Hanukkah game); the original game never reaches this code.
/// Every rule is checked here on the server — the client only sends intents.
/// </summary>
public sealed partial class GameEngine
{
    public static readonly string[] MechanismTypes = ["slots", "maze", "mosaic", "dials"];

    // ---------------------------------------------------------------- clues

    public ActionOutcome DiscoverClue(GameRoom room, Guid playerId, string clueId, DateTime now)
    {
        var p = FindPlayer(room, playerId);
        if (p == null) return NotInRoom();
        if (room.Phase != RoomPhase.Playing) return ActionOutcome.Fail("not-playing", "המשחק אינו פעיל כרגע.");
        var scenario = catalog.Get(room.ScenarioId);
        var clue = scenario.Clues.FirstOrDefault(c => c.Id == clueId);
        if (clue == null) return ActionOutcome.Fail("unknown-clue", "הרמז לא נמצא.");
        if (!UnlockedZones(room, scenario).Contains(clue.Zone)) return ActionOutcome.Fail("zone-locked", "האזור הזה עדיין נעול.");
        var world = World(room);
        if (world.Clues.ContainsKey(clue.Id)) return new ActionOutcome(true, "known", clue.Text, [], false);

        world.Clues[clue.Id] = playerId.ToString();
        Contribute(world, playerId);
        var notices = new List<GameNotice> { new("clue", $"{p.Nickname} גילה רמז!", p.Id.ToString(), Zone: clue.Zone) };
        Award(world, scenario, $"clue:{clue.Id}", p, scenario.Scoring?.Clue ?? 0, "clue", "נמצא רמז חדש", clue.Zone, null, now, notices);
        // reading this clue opens a hiding place: its item appears in the room for everyone
        if (clue.RevealsItem is { } hidden && !world.WorldItems.Contains(hidden) && !world.Inventory.Contains(hidden))
        {
            world.WorldItems.Add(hidden);
            notices.Add(new("item-revealed", $"נפתח מקום מסתור — {scenario.Item(hidden)?.Name ?? hidden} מחכה בחדר", p.Id.ToString(), Zone: clue.Zone, ItemId: hidden));
        }
        SaveWorld(room, world, now);
        return ActionOutcome.Done(clue.Text, notices.ToArray());
    }

    // ---------------------------------------------------------------- mechanisms

    public ActionOutcome Operate(GameRoom room, Guid playerId, string puzzleId, JsonElement action, DateTime now)
    {
        var check = CheckPuzzleAccess(room, playerId, puzzleId, now, out var scenario, out var puzzle, out var state, out var player);
        if (check != null) return check;
        if (!MechanismTypes.Contains(puzzle!.Type)) return ActionOutcome.Fail("wrong-action", "את החידה הזאת פותרים בהזנת תשובה.");
        string op;
        try { op = action.GetProperty("op").GetString() ?? ""; }
        catch (Exception) { return ActionOutcome.Fail("bad-action", "הפעולה לא נשלחה בצורה תקינה."); }

        var world = World(room);
        var mech = world.Mechanisms.TryGetValue(puzzle.Id, out var m) ? m : world.Mechanisms[puzzle.Id] = NewMechanism(puzzle);
        try
        {
            return puzzle.Type switch
            {
                "slots" => OperateSlots(room, scenario!, puzzle, state!, player!, world, mech, op, action, now),
                "maze" => OperateMaze(room, scenario!, puzzle, state!, player!, world, mech, op, action, now),
                "mosaic" => OperateMosaic(room, scenario!, puzzle, state!, player!, world, mech, op, action, now),
                "dials" => OperateDials(room, scenario!, puzzle, state!, player!, world, mech, op, action, now),
                _ => ActionOutcome.Fail("wrong-action", "פעולה לא מוכרת."),
            };
        }
        catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return ActionOutcome.Fail("bad-action", "הפעולה לא נשלחה בצורה תקינה.");
        }
    }

    private static MechanismState NewMechanism(PuzzleContent puzzle)
    {
        var m = new MechanismState();
        switch (puzzle.Type)
        {
            case "maze":
                var grid = MazeGrid(puzzle);
                for (var r = 0; r < grid.Length; r++)
                    for (var c = 0; c < grid[r].Length; c++)
                        if (grid[r][c] == 'S') m.Key = [r, c];
                m.Levers = puzzle.PublicData["levers"]!.AsArray().Select(_ => false).ToList();
                break;
            case "mosaic":
            case "dials":
                m.Rotations = puzzle.PublicData["start"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
                break;
        }
        return m;
    }

    // ---- slots: lamp assembly, dreidel stand, pedestals

    private ActionOutcome OperateSlots(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var slotIds = puzzle.PublicData["slots"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        var accepts = puzzle.PublicData["accepts"]!.AsArray().Select(n => n!.GetValue<string>()).ToHashSet();
        var activateMode = puzzle.PublicData["mode"]?.GetValue<string>() == "activate";
        var checkEach = puzzle.PublicData["checkEach"]?.GetValue<bool>() == true;
        // an automatic mechanism may still offer a "check" button that explains what is wrong (the dreidel stand)
        var checkButton = puzzle.PublicData["checkButton"]?.GetValue<bool>() == true;
        var solution = puzzle.Solution["slots"]!.AsObject();
        bool Correct() => slotIds.All(id => mech.Slots.TryGetValue(id, out var it) && solution[id]!.GetValue<string>() == it);

        switch (op)
        {
            case "place":
            {
                var slot = action.GetProperty("slot").GetString() ?? "";
                var itemId = action.GetProperty("item").GetString() ?? "";
                if (!slotIds.Contains(slot)) return ActionOutcome.Fail("bad-slot", "המקום הזה לא קיים.");
                if (mech.Slots.ContainsKey(slot)) return ActionOutcome.Fail("slot-taken", "המקום הזה כבר תפוס. הרימו קודם את מה שמונח בו.");
                if (!world.Inventory.Contains(itemId)) return ActionOutcome.Fail("item-missing", "החפץ הזה אינו בתיק. הרימו אותו קודם.");
                if (!accepts.Contains(itemId)) return ActionOutcome.Fail("not-fitting", "החפץ הזה לא שייך למתקן הזה.");
                var item = scenario.Item(itemId)!;
                var notices = new List<GameNotice>();
                // checked one by one (the lamp on the workbench): a wrong place is refused with clear feedback,
                // a right place snaps in and scores at once (spec 6, 7)
                if (checkEach)
                {
                    if (solution[slot]!.GetValue<string>() != itemId)
                        return ActionOutcome.Fail("wrong-place", $"זה לא המקום של {item.Name}. הרימו אותו ונסו מקום אחר.");
                    notices.Add(new("item-placed", $"{player.Nickname} הניח את {item.Name} במקום הנכון", player.Id.ToString(), puzzle.Id, ItemId: itemId));
                    Award(world, scenario, $"placement:{puzzle.Id}:{slot}", player, scenario.Scoring?.Placement ?? 0, "placement",
                        $"{item.Name} הונח במקום הנכון", puzzle.Zone, puzzle.Id, now, notices);
                }
                else notices.Add(new("item-placed", $"{player.Nickname} הניח {item.Name}", player.Id.ToString(), puzzle.Id, ItemId: itemId));
                world.Inventory.Remove(itemId);
                mech.Slots[slot] = itemId;
                mech.SlotBy[slot] = player.Id.ToString();
                Contribute(world, player.Id);
                var full = mech.Slots.Count == slotIds.Count;
                if (full && puzzle.Solution["backs"] is JsonObject backs)
                    mech.Backs = mech.Slots.ToDictionary(kv => kv.Key, kv => backs[kv.Value]?.GetValue<string>() ?? "");
                mech.Ready = full && Correct();
                if (full && !mech.Ready)
                {
                    state.Attempts++;
                    SaveWorld(room, world, now);
                    notices.Add(new("wrong-answer", puzzle.Failure, player.Id.ToString(), puzzle.Id));
                    return new ActionOutcome(true, "placed-wrong", puzzle.Failure, notices, true);
                }
                if (mech.Ready && !activateMode)
                {
                    state.Attempts++;
                    SaveWorld(room, world, now);
                    return Solve(room, scenario, puzzle, state, player, now, notices);
                }
                SaveWorld(room, world, now);
                return new ActionOutcome(true, "placed", mech.Ready ? $"כל החלקים במקומם — אפשר ללחוץ „{puzzle.PublicData["activateLabel"]}”." : $"{item.Name} הונח", notices, true);
            }
            case "remove":
            {
                var slot = action.GetProperty("slot").GetString() ?? "";
                if (!mech.Slots.TryGetValue(slot, out var itemId)) return ActionOutcome.Fail("slot-empty", "המקום הזה ריק.");
                mech.Slots.Remove(slot);
                mech.SlotBy.Remove(slot);
                mech.Ready = false;
                mech.Backs.Clear();
                world.Inventory.Add(itemId);
                SaveWorld(room, world, now);
                return ActionOutcome.Done($"{scenario.Item(itemId)?.Name} חזר לתיק");
            }
            case "activate":
            {
                // "Check assembly": says what is missing, or completes the mechanism when everything is in place
                if (!activateMode && !checkEach && !checkButton) return ActionOutcome.Fail("wrong-action", "המתקן הזה פועל מעצמו כשהכול במקומו.");
                var missing = slotIds.Count - mech.Slots.Count;
                if (missing > 0)
                    return ActionOutcome.Fail("not-ready", puzzle.PublicData["incompleteMessage"]?.GetValue<string>()
                        ?? (missing == 1 ? "חסר עוד חלק אחד." : $"חסרים עוד {missing} חלקים."));
                if (!mech.Ready || !Correct()) return ActionOutcome.Fail("not-ready", puzzle.Failure);
                state.Attempts++;
                return Solve(room, scenario, puzzle, state, player, now);
            }
            case "reset":
            {
                // "Return parts": only this assembly goes back to the start; nothing else in the room changes
                if (mech.Slots.Count == 0) return new ActionOutcome(true, "noop", "כל החלקים כבר בתיק.", [], false);
                foreach (var it in mech.Slots.Values) world.Inventory.Add(it);
                mech.Slots.Clear();
                mech.SlotBy.Clear();
                mech.Ready = false;
                mech.Backs.Clear();
                SaveWorld(room, world, now);
                return ActionOutcome.Done("החלקים חזרו למקומות ההתחלה שלהם");
            }
            default:
                return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        }
    }

    // ---- maze

    private static string[] MazeGrid(PuzzleContent puzzle) => puzzle.PublicData["grid"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();

    private static readonly Dictionary<string, (int dr, int dc)> Steps = new() { ["N"] = (-1, 0), ["E"] = (0, 1), ["S"] = (1, 0), ["W"] = (0, -1) };

    /// <summary>Whether the key may stand on a cell: not a wall, and a gate only while its lever is on.</summary>
    public static bool MazeOpen(PuzzleContent puzzle, MechanismState mech, int r, int c)
    {
        var grid = MazeGrid(puzzle);
        if (r < 0 || r >= grid.Length || c < 0 || c >= grid[r].Length) return false;
        var ch = grid[r][c];
        if (ch == '#') return false;
        var levers = puzzle.PublicData["levers"]!.AsArray();
        for (var i = 0; i < levers.Count; i++)
            if (levers[i]!["gate"]!.GetValue<string>()[0] == ch) return mech.Levers[i];
        return true;
    }

    private ActionOutcome OperateMaze(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        var grid = MazeGrid(puzzle);
        if (op == "lever")
        {
            var i = action.GetProperty("index").GetInt32();
            if (i < 0 || i >= mech.Levers.Count) return ActionOutcome.Fail("bad-lever", "המנוף הזה לא קיים.");
            mech.Levers[i] = !mech.Levers[i];
            Contribute(world, player.Id);
            SaveWorld(room, world, now);
            var label = puzzle.PublicData["levers"]![i]!["label"]!.GetValue<string>();
            return ActionOutcome.Done($"{label} {(mech.Levers[i] ? "הופעל — שער נפתח" : "הוחזר — שער נסגר")}");
        }
        if (op != "move") return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        if (!Steps.TryGetValue(action.GetProperty("dir").GetString() ?? "", out var step)) return ActionOutcome.Fail("bad-action", "כיוון לא מוכר.");
        var (r, c) = (mech.Key[0] + step.dr, mech.Key[1] + step.dc);
        if (!MazeOpen(puzzle, mech, r, c))
            return new ActionOutcome(false, "blocked", grid[r][c] == '#' ? "קיר — המפתח לא יכול לעבור." : "שער סגור חוסם את הדרך.", [], false);
        mech.Key = [r, c];
        var cell = grid[r][c].ToString();
        var order = puzzle.Solution["order"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var symbols = puzzle.PublicData["symbols"]!.AsObject();
        var names = puzzle.PublicData["symbolNames"]!.AsObject();
        var notices = new List<GameNotice>();

        if (symbols[cell] is JsonNode symNode)
        {
            var symbol = symNode.GetValue<string>();
            var index = order.IndexOf(symbol);
            if (index == mech.Progress)
            {
                mech.Progress++;
                Contribute(world, player.Id);
                var name = names[symbol]!.GetValue<string>();
                notices.Add(new("maze-symbol", $"{player.Nickname} העביר את המפתח דרך ה{name}", player.Id.ToString(), puzzle.Id));
                Award(world, scenario, $"stage:{puzzle.Id}:{symbol}", player, scenario.Scoring?.Stage ?? 0, "stage", $"המפתח עבר ב{name}", puzzle.Zone, puzzle.Id, now, notices);
            }
            else if (index > mech.Progress)
            {
                // a symbol out of order sends the key back to the start
                state.Attempts++;
                mech.Progress = 0;
                for (var rr = 0; rr < grid.Length; rr++)
                    for (var cc = 0; cc < grid[rr].Length; cc++)
                        if (grid[rr][cc] == 'S') mech.Key = [rr, cc];
                SaveWorld(room, world, now);
                notices.Add(new("wrong-answer", $"{player.Nickname}: {puzzle.Failure}", player.Id.ToString(), puzzle.Id));
                return new ActionOutcome(false, "wrong-order", puzzle.Failure, notices, true);
            }
        }
        if (cell == "E")
        {
            if (mech.Progress < order.Count)
            {
                SaveWorld(room, world, now);
                return new ActionOutcome(false, "box-closed", "תא האיסוף לא נפתח — המפתח עוד לא עבר בכל הסמלים לפי הסדר.", notices, true);
            }
            mech.Revealed = puzzle.Solution["revealCode"]?.GetValue<string>();
            SaveWorld(room, world, now);
            state.Attempts++;
            return Solve(room, scenario, puzzle, state, player, now, notices);
        }
        SaveWorld(room, world, now);
        return new ActionOutcome(true, "moved", "", notices, true);
    }

    // ---- mosaic

    /// <summary>Openings of a stone after its quarter turns (0=N, 1=E, 2=S, 3=W).</summary>
    public static int[] Openings(string tile, int rotation)
    {
        int[] baseDirs = tile switch { "straight" => [0, 2], "corner" => [0, 1], "dead" => [0], _ => [] };
        return baseDirs.Select(d => (d + rotation) % 4).ToArray();
    }

    /// <summary>
    /// Follows the light from the entry. Returns the cells it lights and whether it reaches the target.
    /// The light stops at a blocked edge, at the board's edge or when it would loop.
    /// </summary>
    public static (List<int[]> Cells, bool Reached) TraceLight(JsonObject data, IReadOnlyList<int> rotations)
    {
        var size = data["size"]!.GetValue<int>();
        var tiles = data["tiles"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
        var targetRow = data["target"]!["row"]!.GetValue<int>();
        int r = data["entry"]!["row"]!.GetValue<int>(), c = 0, from = 3; // enters the left column from the west
        var cells = new List<int[]>();
        var seen = new HashSet<int>();
        int[] dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];
        while (true)
        {
            var i = r * size + c;
            if (!seen.Add(i)) return (cells, false);
            var open = Openings(tiles[i], rotations[i]);
            if (!open.Contains(from) || open.Length < 2) return (cells, false);
            cells.Add([r, c]);
            var to = open.First(d => d != from);
            var (nr, nc) = (r + dr[to], c + dc[to]);
            if (nr < 0 || nr >= size || nc < 0 || nc >= size) return (cells, to == 1 && nc == size && r == targetRow);
            (r, c, from) = (nr, nc, (to + 2) % 4);
        }
    }

    private ActionOutcome OperateMosaic(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        if (op != "rotate") return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        var i = action.GetProperty("index").GetInt32();
        if (i < 0 || i >= mech.Rotations.Count) return ActionOutcome.Fail("bad-stone", "האבן הזאת לא קיימת.");
        mech.Rotations[i] = (mech.Rotations[i] + 1) % 4;
        Contribute(world, player.Id);
        SaveWorld(room, world, now);
        var (_, reached) = TraceLight(puzzle.PublicData, mech.Rotations);
        if (!reached) return new ActionOutcome(true, "rotated", "", [], true);
        state.Attempts++;
        return Solve(room, scenario, puzzle, state, player, now);
    }

    // ---------------------------------------------------------------- dials (e.g. two mirrors that guide a light beam)

    /// <summary>
    /// Each dial turns one step at a time through its positions (either way). When every dial stands in its
    /// solution position the mechanism completes; the positions themselves stay on the server.
    /// </summary>
    private ActionOutcome OperateDials(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PuzzleState state,
        PlayerSession player, WorldState world, MechanismState mech, string op, JsonElement action, DateTime now)
    {
        if (op != "rotate") return ActionOutcome.Fail("bad-action", "פעולה לא מוכרת.");
        var i = action.GetProperty("index").GetInt32();
        var dials = puzzle.PublicData["dials"]!.AsArray();
        if (i < 0 || i >= mech.Rotations.Count || i >= dials.Count) return ActionOutcome.Fail("bad-dial", "החלק הזה לא קיים.");
        var positions = dials[i]!["positions"]!.GetValue<int>();
        var step = action.TryGetProperty("dir", out var d) && d.ValueKind == JsonValueKind.Number && d.GetInt32() < 0 ? -1 : 1;
        mech.Rotations[i] = ((mech.Rotations[i] + step) % positions + positions) % positions;
        Contribute(world, player.Id);
        var target = puzzle.Solution["positions"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
        var done = target.Count == mech.Rotations.Count && target.Zip(mech.Rotations).All(t => t.First == t.Second);
        SaveWorld(room, world, now);
        if (!done) return new ActionOutcome(true, "rotated", "", [], true);
        state.Attempts++;
        return Solve(room, scenario, puzzle, state, player, now);
    }

    // ---------------------------------------------------------------- scoring

    /// <summary>Gives points once per key. Group awards have no player. Adds the matching notice (spec §20).</summary>
    private static void Award(WorldState world, ScenarioContent scenario, string key, PlayerSession? player, int points, string type,
        string reason, string? zone, string? puzzleId, DateTime now, List<GameNotice> notices)
    {
        if (scenario.Scoring == null || points == 0) return;
        var board = world.Score ??= new ScoreBoard();
        if (board.Log.Any(e => e.Key == key)) return;
        var pid = player?.Id.ToString();
        board.Log.Add(new ScoreEntry(key, pid, pid == null ? "group" : "personal", type, points, reason, zone, puzzleId, now));
        if (pid == null)
        {
            board.Group += points;
            if (zone != null) board.Rooms[zone] = board.Rooms.GetValueOrDefault(zone) + points;
            notices.Add(new GameNotice("score-group", $"+{points} נקודות לקבוצה — {reason}", Zone: zone, Points: points));
        }
        else
        {
            board.Personal[pid] = board.Personal.GetValueOrDefault(pid) + points;
            notices.Add(new GameNotice("score", $"+{points} נקודות — {reason}", pid, puzzleId, Zone: zone, Points: points));
        }
    }

    /// <summary>Points for solving a puzzle: the answer or mechanism, correct placements, and the room's group points.</summary>
    private void ScoreSolve(GameRoom room, ScenarioContent scenario, PuzzleContent puzzle, PlayerSession player, WorldState world, DateTime now, List<GameNotice> notices)
    {
        if (scenario.Scoring is not { } rules) return;
        var board = world.Score ??= new ScoreBoard();
        var pid = player.Id.ToString();
        board.Solved[pid] = board.Solved.GetValueOrDefault(pid) + 1;

        if (MechanismTypes.Contains(puzzle.Type))
        {
            notices.Add(new("mechanism", $"{player.Nickname} הפעיל את המנגנון בהצלחה!", pid, puzzle.Id));
            Award(world, scenario, $"mechanism:{puzzle.Id}", player, rules.Mechanism, "mechanism", "המנגנון הופעל בהצלחה", puzzle.Zone, puzzle.Id, now, notices);
        }
        else
            Award(world, scenario, $"answer:{puzzle.Id}", player, rules.Answer, "answer", "תשובה נכונה ראשונה", puzzle.Zone, puzzle.Id, now, notices);

        // each correctly placed part counts for the player who placed it (given only now, so it never reveals a right spot early)
        if (puzzle.Type == "slots" && world.Mechanisms.TryGetValue(puzzle.Id, out var mech))
            foreach (var (slot, by) in mech.SlotBy)
            {
                var placer = FindPlayer(room, Guid.Parse(by));
                if (placer != null)
                    Award(world, scenario, $"placement:{puzzle.Id}:{slot}", placer, rules.Placement, "placement", "פריט הונח במקום הנכון", puzzle.Zone, puzzle.Id, now, notices);
            }

        notices.Add(new("team-solved", "הקבוצה פתרה את החידה!", PuzzleId: puzzle.Id));

        // the room is complete when all its puzzles are solved: group points minus the hints used in it
        var roomPuzzles = scenario.Puzzles.Where(p => p.Zone == puzzle.Zone).ToList();
        if (roomPuzzles.All(p => room.Puzzles.First(s => s.PuzzleId == p.Id).Status == PuzzleStatus.Solved))
        {
            var basePoints = rules.Room[scenario.ZoneDifficulty[puzzle.Zone]];
            var hints = roomPuzzles.Sum(p => room.Puzzles.First(s => s.PuzzleId == p.Id).HintsRevealed);
            var points = Math.Max(0, basePoints - hints * rules.HintPenalty);
            var zoneName = scenario.Zones.First(z => z.Id == puzzle.Zone).Name;
            Award(world, scenario, $"room:{puzzle.Zone}", null, points, "room", hints > 0 ? $"{zoneName} הושלם ({hints} רמזים)" : $"{zoneName} הושלם", puzzle.Zone, null, now, notices);
        }
    }

    /// <summary>Final ranking: personal points, then puzzles completed as the tie-break; equal on both = a tie.</summary>
    public static List<(PlayerSession Player, int Points, int Solved, int Rank)> Ranking(GameRoom room, WorldState world)
    {
        var board = world.Score ?? new ScoreBoard();
        var rows = ActivePlayers(room)
            .Select(p => (Player: p, Points: board.Personal.GetValueOrDefault(p.Id.ToString()), Solved: board.Solved.GetValueOrDefault(p.Id.ToString())))
            .OrderByDescending(x => x.Points).ThenByDescending(x => x.Solved).ThenBy(x => x.Player.Seat).ToList();
        var result = new List<(PlayerSession, int, int, int)>();
        for (var i = 0; i < rows.Count; i++)
        {
            var rank = i > 0 && rows[i].Points == rows[i - 1].Points && rows[i].Solved == rows[i - 1].Solved ? result[i - 1].Item4 : i + 1;
            result.Add((rows[i].Player, rows[i].Points, rows[i].Solved, rank));
        }
        return result;
    }
}
