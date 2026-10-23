using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>Spec Part I "בדיקות החידות" and "בדיקות ניקוד" for the Hanukkah game, against the server engine.</summary>
public class HanukkahEngineTests
{
    private const string Scenario = "hanukkah-oil";
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Content => Catalog.Get(Scenario);

    private static (GameEngine engine, GameRoom room, List<PlayerSession> ps) Start(int players = 2)
    {
        var engine = new GameEngine(Catalog, new GameOptions());
        var room = engine.CreateRoom(Scenario, "HNK234", "hash", T0);
        var ps = new List<PlayerSession>();
        string[] names = ["ישראל", "דוד", "אורי", "משה", "יונתן", "נתן", "שמואל", "אליהו"];
        for (var i = 0; i < players; i++)
        {
            Assert.True(engine.AddPlayer(room, names[i], GameEngine.Characters[i % 4], "{}", "t" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        foreach (var p in ps.Skip(1)) engine.SetReady(room, p.Id, true);
        Assert.True(engine.StartGame(room, ps[0].Id, T0).Ok);
        Assert.True(engine.FinishIntro(room, ps[0].Id, true, T0).Ok);
        return (engine, room, ps);
    }

    private static ActionOutcome Op(GameEngine e, GameRoom r, PlayerSession p, string puzzle, object action) => e.Operate(r, p.Id, puzzle, J(action), T0);
    private static WorldState W(GameRoom r) => GameEngine.World(r);
    private static PuzzleStatus Status(GameRoom r, string id) => r.Puzzles.First(p => p.PuzzleId == id).Status;
    private static int Personal(GameRoom r, PlayerSession p) => W(r).Score!.Personal.GetValueOrDefault(p.Id.ToString());

    // ------------------------------------------------------------------ the rooms one by one

    private static void Room1(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        Assert.True(e.DiscoverClue(r, ps[0].Id, "r1-letter", T0).Ok);
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[1].Id, "h1-riddle", J("מנורת שמן"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Contains("antique-key", W(r).Inventory);
        Assert.Contains("workshop", e.UnlockedZones(r, Content));
    }

    private static void Room2(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        string[] parts = ["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"];
        foreach (var part in parts) Assert.True(e.PickUp(r, ps[0].Id, part, T0).Ok);
        // a part dropped on the wrong spot is refused with feedback and stays available (spec 7)
        var wrong = Op(e, r, ps[1], "h2-lamp", new { op = "place", slot = "s1", item = "lamp-tank" });
        Assert.Equal("wrong-place", wrong.Code);
        Assert.Contains("lamp-tank", W(r).Inventory);
        Assert.True(Op(e, r, ps[1], "h2-lamp", new { op = "place", slot = "s1", item = "lamp-base" }).Ok);
        Assert.True(Op(e, r, ps[0], "h2-lamp", new { op = "place", slot = "s2", item = "lamp-tank" }).Ok);
        Assert.True(Op(e, r, ps[1], "h2-lamp", new { op = "place", slot = "s3", item = "lamp-wick" }).Ok);
        Assert.Equal("not-ready", Op(e, r, ps[0], "h2-lamp", new { op = "activate" }).Code); // "check assembly": parts missing
        // "Return parts" puts only this assembly back; points already earned are not given again
        Assert.True(Op(e, r, ps[0], "h2-lamp", new { op = "reset" }).Ok);
        Assert.Empty(W(r).Mechanisms["h2-lamp"].Slots);
        Assert.Equal(5, parts.Count(W(r).Inventory.Contains));
        string[] order = ["lamp-base", "lamp-tank", "lamp-wick", "lamp-glass", "lamp-cover"]; // base → tank → wick → glass → cover
        for (var i = 0; i < 4; i++) Assert.True(Op(e, r, ps[0], "h2-lamp", new { op = "place", slot = $"s{i + 1}", item = order[i] }).Ok);
        Assert.Equal("solved", Op(e, r, ps[1], "h2-lamp", new { op = "place", slot = "s5", item = "lamp-cover" }).Code);
        Assert.Contains("menorah-symbol", W(r).Inventory);
    }

    /// <summary>The intended route of the magnetic maze (S → star → flame → menorah → exit), levers on the way.</summary>
    private static void Room3(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        var p = ps[0];
        void Move(string dir, bool ok = true) => Assert.Equal(ok, Op(e, r, p, "h3-maze", new { op = "move", dir }).Ok);
        // a shortcut that reaches the menorah first sends the key back to the start
        foreach (var d in "SSSSEE") Move(d.ToString());
        Assert.Equal("wrong-order", Op(e, r, p, "h3-maze", new { op = "move", dir = "E" }).Code);
        Assert.Equal([1, 1], W(r).Mechanisms["h3-maze"].Key);

        Move("E"); Move("E");
        Move("E", ok: false);                                   // gate a is closed
        Assert.True(Op(e, r, ps[1], "h3-maze", new { op = "lever", index = 0 }).Ok);
        foreach (var d in "EEEE") Move(d.ToString());          // star
        Assert.Equal(1, W(r).Mechanisms["h3-maze"].Progress);
        Move("S"); Move("S"); Move("W");
        Assert.True(Op(e, r, ps[1], "h3-maze", new { op = "lever", index = 1 }).Ok);
        foreach (var d in "WWW") Move(d.ToString());           // flame
        Assert.Equal(2, W(r).Mechanisms["h3-maze"].Progress);
        foreach (var d in "SSE") Move(d.ToString());           // menorah
        Assert.Equal(3, W(r).Mechanisms["h3-maze"].Progress);
        Move("E");
        Assert.True(Op(e, r, ps[1], "h3-maze", new { op = "lever", index = 2 }).Ok);
        Move("E");
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h3-box")); // the box waits for the maze
        Assert.Equal("solved", Op(e, r, p, "h3-maze", new { op = "move", dir = "E" }).Code);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h3-box"));
        Assert.Equal("825", W(r).Mechanisms["h3-maze"].Revealed);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h3-box", J("825"), T0).Code);
        Assert.Contains("golden-key", W(r).Inventory);
    }

    private static void Room4(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        Assert.True(e.DiscoverClue(r, ps[1].Id, "r4-gematria", T0).Ok);
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[0].Id, "h4-wheel", J("רוא"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h4-wheel", J(new[] { "א", "ו", "ר" }), T0).Code);
        Assert.Contains("light-stone", W(r).Inventory);
    }

    private static void Room5(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        foreach (var d in new[] { "dreidel-nun", "dreidel-gimel", "dreidel-he", "dreidel-pe" }) Assert.True(e.PickUp(r, ps[1].Id, d, T0).Ok);
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h5-lock"));
        // נ top-left, ג top-right, פ bottom-left, ה bottom-right — by physical position, not by text order
        Op(e, r, ps[0], "h5-stand", new { op = "place", slot = "tl", item = "dreidel-nun" });
        // the check button explains that the stand is not complete yet
        var partial = Op(e, r, ps[0], "h5-stand", new { op = "activate" });
        Assert.False(partial.Ok);
        Assert.Equal("החידה עדיין לא הושלמה. הניחו את כל ארבעת הסביבונים במקומות המתאימים.", partial.Message);
        Op(e, r, ps[0], "h5-stand", new { op = "place", slot = "tr", item = "dreidel-gimel" });
        Op(e, r, ps[1], "h5-stand", new { op = "place", slot = "bl", item = "dreidel-he" });
        var wrong = Op(e, r, ps[1], "h5-stand", new { op = "place", slot = "br", item = "dreidel-pe" });
        Assert.Equal("placed-wrong", wrong.Code);
        Assert.Equal("הסידור אינו נכון. בדקו את הרמזים ונסו שוב.", wrong.Message);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h5-stand"));
        var check = Op(e, r, ps[0], "h5-stand", new { op = "activate" });
        Assert.Equal("הסידור אינו נכון. בדקו את הרמזים ונסו שוב.", check.Message);
        Assert.Equal(PuzzleStatus.Active, Status(r, "h5-stand"));
        // the door lock stays shut while the arrangement is wrong
        Assert.False(e.SubmitAnswer(r, ps[0].Id, "h5-lock", J("4826"), T0).Ok);
        Op(e, r, ps[1], "h5-stand", new { op = "remove", slot = "bl" });
        Op(e, r, ps[1], "h5-stand", new { op = "remove", slot = "br" });
        Op(e, r, ps[1], "h5-stand", new { op = "place", slot = "bl", item = "dreidel-pe" });
        Assert.Equal("solved", Op(e, r, ps[1], "h5-stand", new { op = "place", slot = "br", item = "dreidel-he" }).Code);
        var backs = W(r).Mechanisms["h5-stand"].Backs;
        Assert.Equal("4826", backs["tl"] + backs["tr"] + backs["bl"] + backs["br"]); // left to right, row by row
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h5-lock", J("4826"), T0).Code);
        Assert.Contains("flame-symbol", W(r).Inventory);
    }

    private static void Room6(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[0].Id, "h6-jugs", J("ב"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h6-jugs", J("א"), T0).Code);
        Assert.Contains("golden-jug", W(r).Inventory);
    }

    private static void Room7(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        // stone index → turns needed from the starting position [0,1,2,0,0,3,1,2,1]
        var turns = new Dictionary<int, int> { [3] = 1, [4] = 2, [5] = 2, [7] = 2, [8] = 2 };
        var last = (ActionOutcome?)null;
        foreach (var (i, n) in turns)
            for (var k = 0; k < n; k++)
            {
                Assert.Equal(PuzzleStatus.Active, Status(r, "h7-mosaic")); // the gate stays shut until the path is complete
                last = Op(e, r, ps[k % 2], "h7-mosaic", new { op = "rotate", index = i });
            }
        Assert.Equal("solved", last!.Code);
        Assert.Contains("blue-crystal", W(r).Inventory);
    }

    private static void Room8(GameEngine e, GameRoom r, List<PlayerSession> ps)
    {
        var map = new Dictionary<string, string>
        {
            ["p1"] = "antique-key", ["p2"] = "menorah-symbol", ["p3"] = "golden-key", ["p4"] = "light-stone",
            ["p5"] = "flame-symbol", ["p6"] = "golden-jug", ["p7"] = "blue-crystal",
        };
        Assert.Equal(PuzzleStatus.Locked, Status(r, "h8-final"));
        // swapped key and golden key: the hall does not react
        Op(e, r, ps[0], "h8-pedestals", new { op = "place", slot = "p1", item = "golden-key" });
        Op(e, r, ps[0], "h8-pedestals", new { op = "place", slot = "p3", item = "antique-key" });
        foreach (var slot in new[] { "p2", "p4", "p5", "p6", "p7" }) Op(e, r, ps[1], "h8-pedestals", new { op = "place", slot, item = map[slot] });
        Assert.Equal(PuzzleStatus.Active, Status(r, "h8-pedestals"));
        Op(e, r, ps[0], "h8-pedestals", new { op = "remove", slot = "p1" });
        Op(e, r, ps[0], "h8-pedestals", new { op = "remove", slot = "p3" });
        Op(e, r, ps[0], "h8-pedestals", new { op = "place", slot = "p1", item = "antique-key" });
        Assert.Equal("solved", Op(e, r, ps[0], "h8-pedestals", new { op = "place", slot = "p3", item = "golden-key" }).Code);
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[1].Id, "h8-final", J("7"), T0).Code);
        var end = e.SubmitAnswer(r, ps[1].Id, "h8-final", J("8"), T0);
        Assert.Equal("solved", end.Code);
        Assert.Contains(end.Notices, n => n.Message == "כל הכבוד! גיליתם את סוד פך השמן והשלמתם את מסע החנוכה.");
    }

    [Fact]
    public void All_eight_rooms_can_be_solved_in_order_with_their_exact_answers()
    {
        var (e, r, ps) = Start();
        Assert.Equal(["library"], e.UnlockedZones(r, Content));
        Room1(e, r, ps); Room2(e, r, ps); Room3(e, r, ps); Room4(e, r, ps);
        Room5(e, r, ps); Room6(e, r, ps); Room7(e, r, ps); Room8(e, r, ps);
        Assert.Equal(RoomPhase.Completed, r.Phase);
        Assert.Equal(8, e.UnlockedZones(r, Content).Count);
        Assert.Empty(W(r).Inventory); // every journey item ended on its pedestal
    }

    [Fact]
    public void Rooms_open_only_in_order()
    {
        var (e, r, ps) = Start();
        Assert.Equal("locked", e.SubmitAnswer(r, ps[0].Id, "h4-wheel", J("אור"), T0).Code);
        Assert.Equal("locked", Op(e, r, ps[0], "h3-maze", new { op = "move", dir = "E" }).Code);
        Assert.Equal("zone-locked", e.PickUp(r, ps[0].Id, "lamp-base", T0).Code);
        Assert.Equal("zone-locked", e.DiscoverClue(r, ps[0].Id, "r6-sign", T0).Code);
        Room1(e, r, ps);
        Assert.Equal("locked", e.SubmitAnswer(r, ps[0].Id, "h3-box", J("825"), T0).Code);
    }

    [Fact]
    public void Riddle_answer_is_normalised_but_not_changed()
    {
        var (e, r, ps) = Start();
        Assert.Equal("wrong", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J("שמן"), T0).Code);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J(" פַּךְ הַשֶּׁמֶן "), T0).Code);
    }

    [Fact]
    public void Scores_follow_the_rules_and_are_never_given_twice()
    {
        var (e, r, ps) = Start();
        Assert.True(e.DiscoverClue(r, ps[0].Id, "r1-letter", T0).Ok);
        var again = e.DiscoverClue(r, ps[1].Id, "r1-letter", T0);
        Assert.Equal("known", again.Code);
        Assert.Equal(10, Personal(r, ps[0]));
        Assert.Equal(0, Personal(r, ps[1]));

        Assert.True(e.RequestHint(r, ps[1].Id, "h1-riddle", T0).Ok);
        Assert.Equal("solved", e.SubmitAnswer(r, ps[1].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Equal(25, Personal(r, ps[1]));               // first correct answer
        Assert.Equal(10, Personal(r, ps[0]));               // the hint did not reduce personal points
        Assert.Equal(100 - 10, W(r).Score!.Rooms["library"]); // easy room minus one hint
        Assert.Equal(90, W(r).Score!.Group);
        // the same solve cannot score again
        Assert.Equal("already-solved", e.SubmitAnswer(r, ps[0].Id, "h1-riddle", J("פך השמן"), T0).Code);
        Assert.Equal(25, Personal(r, ps[1]));
        Assert.Equal(W(r).Score!.Log.Count, W(r).Score!.Log.Select(x => x.Key).Distinct().Count());
    }

    [Fact]
    public void Placement_mechanism_and_stage_points_go_to_the_right_players()
    {
        var (e, r, ps) = Start();
        Room1(e, r, ps);
        var before0 = Personal(r, ps[0]);
        var before1 = Personal(r, ps[1]);
        Room2(e, r, ps);
        // each spot scores once, for whoever first placed the right part there (placing it again after "Return parts" does not)
        Assert.Equal(before0 + 5 * 10 + 10 + 10, Personal(r, ps[0]));     // five pickups, s2, s4
        Assert.Equal(before1 + 10 + 10 + 10 + 20, Personal(r, ps[1]));    // s1, s3, s5 + the lamp lights up
        var p0 = Personal(r, ps[0]);
        Room3(e, r, ps);
        Assert.Equal(p0 + 3 * 5 + 20, Personal(r, ps[0]));                // three symbols in order + the maze
    }

    [Fact]
    public void Full_game_group_score_and_ranking()
    {
        var (e, r, ps) = Start();
        Room1(e, r, ps); Room2(e, r, ps); Room3(e, r, ps); Room4(e, r, ps);
        Room5(e, r, ps); Room6(e, r, ps); Room7(e, r, ps); Room8(e, r, ps);
        var board = W(r).Score!;
        Assert.Equal(100 + 100 + 150 + 250 + 150 + 250 + 200 + 150, board.Group); // no hints used
        Assert.Equal(board.Personal.Values.Sum() + board.Group, board.Log.Sum(x => x.Points));
        var ranking = GameEngine.Ranking(r, W(r));
        Assert.Equal(1, ranking[0].Rank);
        Assert.True(ranking[0].Points >= ranking[1].Points);
    }

    [Fact]
    public void Equal_points_and_equal_solves_are_a_tie()
    {
        var (e, r, ps) = Start();
        var w = W(r);
        w.Score!.Personal[ps[0].Id.ToString()] = 40;
        w.Score.Personal[ps[1].Id.ToString()] = 40;
        w.Score.Solved[ps[0].Id.ToString()] = 1;
        w.Score.Solved[ps[1].Id.ToString()] = 1;
        GameEngine.SaveWorld(r, w, T0);
        Assert.All(GameEngine.Ranking(r, W(r)), x => Assert.Equal(1, x.Rank));
        w.Score.Solved[ps[1].Id.ToString()] = 2; // tie-break: more puzzles solved
        GameEngine.SaveWorld(r, w, T0);
        Assert.Equal(ps[1].Id, GameEngine.Ranking(r, W(r))[0].Player.Id);
    }

    [Fact]
    public void Replay_resets_scores_and_mechanisms()
    {
        var (e, r, ps) = Start();
        Room1(e, r, ps); Room2(e, r, ps); Room3(e, r, ps); Room4(e, r, ps);
        Room5(e, r, ps); Room6(e, r, ps); Room7(e, r, ps); Room8(e, r, ps);
        Assert.True(e.PlayAgain(r, ps[0].Id, T0).Ok);
        Assert.Equal(0, W(r).Score!.Group);
        Assert.Empty(W(r).Score!.Log);
        Assert.Equal([1, 1], W(r).Mechanisms["h3-maze"].Key);
    }

    // ------------------------------------------------------------------ the puzzles themselves (spec §12 "gaps")

    [Fact]
    public void Jug_statements_have_exactly_one_answer_and_it_is_jug_aleph()
    {
        var jugs = new[] { "א", "ב", "ג", "ד" };
        bool[] Truths(string pure) => [pure == "ב", pure != "ב", pure != "א", pure == "ד"];
        var valid = jugs.Where(j => Truths(j).Count(t => t) == 1).ToList();
        Assert.Equal(["א"], valid);
        Assert.Equal("א", Content.Puzzle("h6-jugs").Solution["text"]!.GetValue<string>());
    }

    [Fact]
    public void Mosaic_has_exactly_one_light_path_and_it_is_the_described_one()
    {
        var data = Content.Puzzle("h7-mosaic").PublicData;
        var paths = new HashSet<string>();
        for (var code = 0; code < 1 << 18; code++)
        {
            var rot = Enumerable.Range(0, 9).Select(i => (code >> (2 * i)) & 3).ToList();
            var (cells, reached) = GameEngine.TraceLight(data, rot);
            if (reached) paths.Add(string.Join(" ", cells.Select(c => $"{c[0]},{c[1]}")));
        }
        // entry → middle-left → centre → bottom-middle → bottom-right → middle-right → menorah
        Assert.Equal(["1,0 1,1 2,1 2,2 1,2"], paths);
        var start = data["start"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
        Assert.False(GameEngine.TraceLight(data, start).Reached);
    }

    [Fact]
    public void Maze_needs_the_levers_and_the_symbol_order()
    {
        var puzzle = Content.Puzzle("h3-maze");
        var grid = puzzle.PublicData["grid"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray();
        // with all gates closed the exit cannot be reached at all
        var closed = new MechanismState { Levers = [false, false, false] };
        Assert.False(Reachable(puzzle, closed, grid, 'E'));
        Assert.False(Reachable(puzzle, closed, grid, '*'));
        Assert.Equal("825", puzzle.Solution["revealCode"]!.GetValue<string>());
        Assert.Equal("825", Content.Puzzle("h3-box").Solution["text"]!.GetValue<string>());
    }

    private static bool Reachable(PuzzleContent puzzle, MechanismState mech, string[] grid, char target)
    {
        var start = (r: 1, c: 1);
        var seen = new HashSet<(int, int)> { start };
        var queue = new Queue<(int r, int c)>([start]);
        while (queue.Count > 0)
        {
            var (r, c) = queue.Dequeue();
            if (grid[r][c] == target) return true;
            foreach (var (dr, dc) in new[] { (-1, 0), (1, 0), (0, -1), (0, 1) })
                if (GameEngine.MazeOpen(puzzle, mech, r + dr, c + dc) && seen.Add((r + dr, c + dc))) queue.Enqueue((r + dr, c + dc));
        }
        return false;
    }

    [Fact]
    public void Menorah_and_content_rules()
    {
        // every pedestal item is a reward of one of the first seven rooms, and all are used
        var rewards = Content.Puzzles.Where(p => p.RewardItem != null).Select(p => p.RewardItem!).ToHashSet();
        var pedestal = Content.Puzzle("h8-pedestals").Solution["slots"]!.AsObject().Select(kv => kv.Value!.GetValue<string>()).ToHashSet();
        Assert.Equal(7, pedestal.Count);
        Assert.Equal(rewards, pedestal);
        // the public scenario never contains solutions
        var pub = Snapshots.PublicScenario(Content).ToJsonString();
        Assert.DoesNotContain("825", pub);
        Assert.DoesNotContain("4826", pub);
        Assert.DoesNotContain("revealCode", pub);
        Assert.DoesNotContain("backs", pub);
    }
}
