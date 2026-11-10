using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "שער הסודות" (the free game), room 1 — the map room in four steps: the torn map (checked only as a whole), the four
/// secret books (one order fits the clues), the crazy compass (its purple flash is seen by one player only) and the
/// cabinet whose code is drawn for each game. Everything secret stays on the server.
/// </summary>
public class GateOfSecretsRoom1Tests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private static ScenarioContent Gate => Catalog.Get("gate-of-secrets");
    private static readonly string[] Books = ["book-red", "book-green", "book-blue", "book-brown"];
    private static readonly string[] Shelf = ["book-green", "book-red", "book-brown", "book-blue"];

    public sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Op(int who, string puzzle, object action, DateTime? at = null) => E.Operate(R, Ps[who % Ps.Count].Id, puzzle, J(action), at ?? T0);
        public WorldState World => GameEngine.World(R);
        public PuzzleStatus Status(string id) => R.Puzzles.First(p => p.PuzzleId == id).Status;
        public PuzzleState State(string id) => R.Puzzles.First(p => p.PuzzleId == id);
        public JsonNode Flash(int who, DateTime at) => E.GetPersonalClues(R, Ps[who].Id, "g1-compass", at).Data!;
    }

    public static Game Start(int players, string code = "GATE01")
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("gate-of-secrets", code, "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "g" + i + code, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return new Game(e, r, ps);
    }

    /// <summary>Picks up what room 1 needs (the middle map piece appears after the note) — players taking turns.</summary>
    public static void Collect(Game g)
    {
        Assert.True(g.E.DiscoverClue(g.R, g.Ps[0].Id, "g1-note", T0).Ok);
        var k = 0;
        foreach (var id in new[] { "map-ridge", "map-river", "map-rose" }.Concat(Books))
            Assert.True(g.E.PickUp(g.R, g.Ps[k++ % g.Ps.Count].Id, id, T0).Ok, id);
    }

    public static void Map(Game g)
    {
        g.Op(0, "g1-map", new { op = "place", slot = "m1", item = "map-ridge" });
        g.Op(1, "g1-map", new { op = "place", slot = "m2", item = "map-river" });
        g.Op(2, "g1-map", new { op = "place", slot = "m3", item = "map-rose" });
        Assert.Equal("solved", g.Op(0, "g1-map", new { op = "activate" }).Code);
    }

    public static void Shelve(Game g)
    {
        for (var i = 0; i < 4; i++) Assert.True(g.Op(i, "g1-books", new { op = "place", slot = $"s{i + 1}", item = Shelf[i] }).Ok);
        Assert.Equal("solved", g.Op(1, "g1-books", new { op = "activate" }).Code);
    }

    /// <summary>The needle to red (from green: three turns one way, or one the other way), then a press.</summary>
    public static ActionOutcome WakeCompass(Game g, int who, DateTime at)
    {
        g.Op(who, "g1-compass", new { op = "turn", dir = -1 }, at);
        return g.Op(who, "g1-compass", new { op = "press" }, at);
    }

    /// <summary>The code as the players read it: the digits on the spines, from the book the arrow points at.</summary>
    public static string ReadCode(Game g, string arrow)
    {
        var backs = g.World.Mechanisms["g1-books"].Backs;
        var digits = new[] { "s1", "s2", "s3", "s4" }.Select(s => backs[s]).ToList();
        if (arrow == "book-blue") digits.Reverse();
        return string.Concat(digits);
    }

    /// <summary>Room 1 from start to the open cabinet; returns the moment after it.</summary>
    public static DateTime PlayRoom1(Game g)
    {
        Collect(g);
        Map(g);
        Shelve(g);
        Assert.Equal("solved", WakeCompass(g, 0, T0).Code);
        var holder = Enumerable.Range(0, g.Ps.Count).First(i => g.Flash(i, T0)["clues"]!.AsArray().Count == 1);
        var arrow = g.Flash(holder, T0)["clues"]![0]!["visual"]!.GetValue<string>();
        Assert.Equal("solved", g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J(ReadCode(g, arrow)), T0).Code);
        return T0.AddSeconds(1);
    }

    private static string Snapshot(Game g, DateTime at) => JsonSerializer.Serialize(Snapshots.Build(g.E, g.R, null, at), ScenarioCatalog.JsonOptions);

    // ------------------------------------------------------------------ the content

    [Fact]
    public void Room_1_has_four_steps_in_a_chain()
    {
        var room1 = Gate.Puzzles.Where(p => p.Zone == "maproom").OrderBy(p => p.Order).Select(p => p.Id).ToArray();
        Assert.Equal(["g1-map", "g1-books", "g1-compass", "g1-cabinet"], room1);
        Assert.Equal("g1-map", Gate.Puzzle("g1-books").RequiresPuzzle);
        Assert.Equal("g1-books", Gate.Puzzle("g1-compass").RequiresPuzzle);
        Assert.Equal("g1-compass", Gate.Puzzle("g1-cabinet").RequiresPuzzle);
        Assert.Equal("gearworks", Gate.Puzzle("g1-cabinet").UnlocksZone);
        Assert.Equal(["g2-pipes", "g2-weights", "g2-gate"], Gate.Puzzles.Where(p => p.Zone == "gearworks").Select(p => p.Id).ToArray());
        Assert.Equal(2, Gate.Zones.Count);
        // two graded hints for every step, and nothing on the room's pages says the forbidden word
        Assert.All(Gate.Puzzles.Where(p => !GameEngine.IsFinale(p)), p => Assert.Equal(2, p.Hints.Count));
        Assert.DoesNotContain("מקדש", File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Content", "scenarios", "gate-of-secrets.he.json")));
    }

    [Fact]
    public void The_map_pieces_names_never_tell_where_they_go()
    {
        foreach (var id in new[] { "map-ridge", "map-river", "map-rose" })
        {
            var item = Gate.Item(id)!;
            foreach (var place in new[] { "שמאל", "ימין", "אמצע", "משמאל", "מימין" }) Assert.DoesNotContain(place, item.Name + " " + item.Description);
            Assert.DoesNotContain("left", id);
            Assert.DoesNotContain("right", id);
            Assert.DoesNotContain("middle", id);
        }
    }

    /// <summary>The three clues as rules (a "before" is a smaller place number); exactly one order of the books keeps them all.</summary>
    [Fact]
    public void Exactly_one_order_of_the_books_fits_the_three_clues()
    {
        static IEnumerable<string[]> Perms(string[] xs) => xs.Length == 1 ? [xs]
            : xs.SelectMany(x => Perms(xs.Where(y => y != x).ToArray()).Select(rest => new[] { x }.Concat(rest).ToArray()));
        bool Fits(string[] o)
        {
            int At(string b) => Array.IndexOf(o, b);
            return At("book-red") is not 0 and not 3                                     // the map: red is neither first nor last
                && At("book-brown") == At("book-red") + 1                                 // the globe: brown right after red
                && At("book-green") < At("book-blue") && At("book-blue") - At("book-green") > 1; // the ink: green before blue, not next to it
        }
        var fitting = Perms(Books).Where(Fits).ToList();
        Assert.Single(fitting);
        Assert.Equal(Shelf, fitting[0]);
        var solution = Gate.Puzzle("g1-books").Solution["slots"]!;
        Assert.Equal(Shelf, new[] { "s1", "s2", "s3", "s4" }.Select(s => solution[s]!.GetValue<string>()).ToArray());
        // the clues the players read say exactly those rules
        Assert.Contains("הספר האדום אינו הראשון ואינו האחרון", Gate.Puzzle("g1-map").Success);
        Assert.Contains("הספר החום עומד מיד אחרי הספר האדום", Gate.Clues.First(c => c.Id == "g1-globe").Text);
        Assert.Contains("הספר הירוק עומד לפני הספר הכחול, אבל אף פעם לא צמוד אליו", Gate.Clues.First(c => c.Id == "g1-ink").Text);
        // without the third clue's "not next to it" two orders would fit: the clue is needed
        Assert.Equal(2, Perms(Books).Count(o => Array.IndexOf(o, "book-red") is 1 or 2 && Array.IndexOf(o, "book-brown") == Array.IndexOf(o, "book-red") + 1
            && Array.IndexOf(o, "book-green") < Array.IndexOf(o, "book-blue")));
    }

    // ------------------------------------------------------------------ 1 · the torn map

    [Fact]
    public void The_map_judges_nothing_while_placing_and_its_check_tells_only_right_or_wrong()
    {
        var g = Start(2);
        Collect(g);
        Assert.Equal("not-ready", g.Op(0, "g1-map", new { op = "activate" }).Code);   // not all on the table yet
        // a wrong piece is accepted where it is laid — no "this is not its place"
        var placed = g.Op(0, "g1-map", new { op = "place", slot = "m1", item = "map-rose" });
        Assert.True(placed.Ok);
        Assert.DoesNotContain("לא המקום", placed.Message);
        g.Op(1, "g1-map", new { op = "place", slot = "m2", item = "map-river" });
        var last = g.Op(1, "g1-map", new { op = "place", slot = "m3", item = "map-ridge" });
        Assert.Equal("placed", last.Code);
        Assert.Contains("בדיקת מפה", last.Message);
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-map"));                         // full but never solved by itself

        // the check: wrong, without saying which piece (no marks on the places either)
        var wrong = g.Op(0, "g1-map", new { op = "activate" });
        Assert.False(wrong.Ok);
        Assert.Equal("wrong-answer", wrong.Code);
        Assert.Equal(Gate.Puzzle("g1-map").Failure, wrong.Message);
        Assert.Empty(g.World.Mechanisms["g1-map"].Verdict);
        Assert.DoesNotContain(wrong.Notices, n => n.Message.Contains("מתוך"));
        // three wrong checks in a row lock the table for a short while (no guessing through all orders)
        g.Op(0, "g1-map", new { op = "activate" });
        Assert.Contains("ננעל", g.Op(0, "g1-map", new { op = "activate" }).Message);
        Assert.Equal("cooldown", g.Op(0, "g1-map", new { op = "activate" }).Code);
        var later = T0.AddSeconds(25);
        // put right: the two ends swap places, then the check opens it
        g.Op(0, "g1-map", new { op = "remove", slot = "m1" }, later);
        g.Op(0, "g1-map", new { op = "remove", slot = "m3" }, later);
        g.Op(0, "g1-map", new { op = "place", slot = "m1", item = "map-ridge" }, later);
        g.Op(1, "g1-map", new { op = "place", slot = "m3", item = "map-rose" }, later);
        var ok = g.Op(1, "g1-map", new { op = "activate" }, later);
        Assert.Equal("solved", ok.Code);
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-books"));
        // every piece in its place scores for whoever laid it, given only now
        var log = g.World.Score!.Log;
        Assert.Equal(3, log.Count(x => x.Key.StartsWith("placement:g1-map")));
        Assert.Single(log, x => x.Key == "mechanism:g1-map");
    }

    // ------------------------------------------------------------------ 2 · the books, with digits drawn for each game

    [Fact]
    public void The_books_digits_are_drawn_per_game_and_shown_only_once_the_order_is_right()
    {
        var g = Start(1);
        var secrets = g.World.Secrets!;
        var digits = Books.Select(b => secrets[$"digit:{b}"]).ToList();
        Assert.Equal(4, digits.Distinct().Count());
        Assert.All(digits, d => Assert.InRange(int.Parse(d), 1, 9));
        Assert.Contains(secrets["arrow"], new[] { "book-green", "book-blue" });   // one end of the shelf
        Collect(g);
        Assert.Equal("locked", g.Op(0, "g1-books", new { op = "place", slot = "s1", item = "book-green" }).Code); // the map first
        Map(g);
        // a wrong order: the check fails, and no digit shows
        g.Op(0, "g1-books", new { op = "place", slot = "s1", item = "book-red" });
        g.Op(0, "g1-books", new { op = "place", slot = "s2", item = "book-green" });
        g.Op(0, "g1-books", new { op = "place", slot = "s3", item = "book-brown" });
        g.Op(0, "g1-books", new { op = "place", slot = "s4", item = "book-blue" });
        Assert.Equal("wrong-answer", g.Op(0, "g1-books", new { op = "activate" }).Code);
        Assert.Empty(g.World.Mechanisms["g1-books"].Backs);
        Assert.Equal("ok", g.Op(0, "g1-books", new { op = "reset" }).Code);
        Shelve(g);
        var backs = g.World.Mechanisms["g1-books"].Backs;
        Assert.Equal(Shelf.Select(b => secrets[$"digit:{b}"]), new[] { "s1", "s2", "s3", "s4" }.Select(s => backs[s]));
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-compass"));
    }

    [Fact]
    public void Different_games_draw_different_codes_and_a_game_keeps_its_own_from_start_to_end()
    {
        var codes = Enumerable.Range(0, 24).Select(i =>
        {
            var g = Start(1, $"GC{i:00}AB");
            return GameEngine.GeneratedCode(Gate, g.World);
        }).ToList();
        Assert.True(codes.Distinct().Count() > 12);
        Assert.All(codes, c => Assert.Matches("^[1-9]{4}$", c));

        var game = Start(2);
        var before = GameEngine.GeneratedCode(Gate, game.World);
        Collect(game);
        Map(game);
        Shelve(game);
        WakeCompass(game, 0, T0);
        Assert.Equal(before, GameEngine.GeneratedCode(Gate, game.World));
    }

    // ------------------------------------------------------------------ 3 · the compass and its private flash

    [Fact]
    public void The_compass_wakes_only_on_the_right_mark_and_only_after_the_books()
    {
        var g = Start(2);
        Assert.Equal("locked", g.Op(0, "g1-compass", new { op = "press" }).Code);
        Collect(g);
        Map(g);
        Shelve(g);
        // the needle starts on green: a press there does nothing (a wrong try)
        var wrong = g.Op(0, "g1-compass", new { op = "press" });
        Assert.Equal("wrong-answer", wrong.Code);
        Assert.Equal(Gate.Puzzle("g1-compass").Failure, wrong.Message);
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-compass"));
        // turning moves the needle for everyone (shared state), around the four marks
        Assert.Contains("כחול", g.Op(1, "g1-compass", new { op = "turn", dir = 1 }).Message);
        Assert.Equal(1, g.World.Mechanisms["g1-compass"].Progress);
        Assert.Contains("ירוק", g.Op(1, "g1-compass", new { op = "turn", dir = -1 }).Message);
        Assert.Contains("אדום", g.Op(1, "g1-compass", new { op = "turn", dir = -1 }).Message);
        var woke = g.Op(1, "g1-compass", new { op = "press" });
        Assert.Equal("solved", woke.Code);
        Assert.Contains(woke.Notices, n => n.Kind == "compass-flash");
        Assert.Equal(PuzzleStatus.Active, g.Status("g1-cabinet"));
        // the flash's own state is only when it ends — never what it shows
        var mech = g.World.Mechanisms["g1-compass"];
        Assert.Equal(T0.AddSeconds(2.2), mech.ControlUntil);
        Assert.Null(mech.Revealed);
    }

    [Fact]
    public void Only_one_player_sees_the_flash_and_only_while_it_lasts()
    {
        var g = Start(4);
        Collect(g);
        Map(g);
        Shelve(g);
        // before the compass wakes, nobody gets anything
        Assert.All(Enumerable.Range(0, 4), i => Assert.Empty(g.Flash(i, T0)["clues"]!.AsArray()));
        WakeCompass(g, 0, T0);
        var seen = Enumerable.Range(0, 4).Where(i => g.Flash(i, T0.AddSeconds(1))["clues"]!.AsArray().Count == 1).ToList();
        Assert.Equal([1], seen);                                     // the second seat — not always the host
        var clue = g.Flash(1, T0.AddSeconds(1))["clues"]![0]!;
        var arrow = g.World.Secrets!["arrow"];
        Assert.Equal(arrow, clue["visual"]!.GetValue<string>());
        Assert.Contains(Gate.Item(arrow)!.Name, clue["text"]!.GetValue<string>());
        Assert.Equal(2200, g.Flash(1, T0)["holdMs"]!.GetValue<int>());
        Assert.False(g.Flash(1, T0)["solo"]!.GetValue<bool>());
        // nothing the others receive tells it: not the snapshot, not the notices, not the public scenario
        var snap = Snapshot(g, T0.AddSeconds(1));
        Assert.DoesNotContain("arrow", snap);
        Assert.DoesNotContain("\"secrets\"", snap, StringComparison.OrdinalIgnoreCase);   // (the game id itself is "gate-of-secrets")
        Assert.DoesNotContain("{book}", Snapshots.PublicScenario(Gate).ToJsonString());
        Assert.DoesNotContain("personalClues", Snapshots.PublicScenario(Gate).ToJsonString());
        // after the flash (and a short grace for the network), even its holder no longer gets it
        Assert.Empty(g.Flash(1, T0.AddSeconds(5))["clues"]!.AsArray());
        // it can be shown again (after a short pause), to the same holder
        Assert.Equal("cooldown", g.Op(2, "g1-compass", new { op = "press" }, T0.AddSeconds(3)).Code);
        Assert.Equal("flash", g.Op(2, "g1-compass", new { op = "press" }, T0.AddSeconds(8)).Code);
        Assert.Single(g.Flash(1, T0.AddSeconds(9))["clues"]!.AsArray());
        Assert.Empty(g.Flash(2, T0.AddSeconds(9))["clues"]!.AsArray());
    }

    [Fact]
    public void Alone_the_player_sees_the_flash_and_is_told_to_remember_it()
    {
        var g = Start(1);
        Collect(g);
        Map(g);
        Shelve(g);
        WakeCompass(g, 0, T0);
        var data = g.Flash(0, T0.AddSeconds(1));
        Assert.Single(data["clues"]!.AsArray());
        Assert.True(data["solo"]!.GetValue<bool>());
    }

    [Fact]
    public void When_the_holder_is_away_the_flash_goes_to_the_others_and_a_reconnect_keeps_the_same_holder()
    {
        var g = Start(2);
        Collect(g);
        Map(g);
        Shelve(g);
        WakeCompass(g, 0, T0);
        // the holder drops for a moment and comes back: still the holder
        g.Ps[1].IsConnected = false;
        g.Ps[1].DisconnectedAt = T0;
        g.Ps[1].IsConnected = true;
        g.Ps[1].DisconnectedAt = null;
        Assert.Single(g.Flash(1, T0.AddSeconds(1))["clues"]!.AsArray());
        // gone for longer than a minute: the next flash is shown to the one who is here, marked as the other's
        g.Ps[1].IsConnected = false;
        g.Ps[1].DisconnectedAt = T0;
        var at = T0.AddSeconds(70);
        Assert.Equal("flash", g.Op(0, "g1-compass", new { op = "press" }, at).Code);
        var clue = g.Flash(0, at.AddSeconds(1))["clues"]!.AsArray();
        Assert.Single(clue);
        Assert.True(clue[0]!["away"]!.GetValue<bool>());
        Assert.Equal(g.Ps[1].Nickname, clue[0]!["from"]!.GetValue<string>());
    }

    // ------------------------------------------------------------------ 4 · the cabinet with the changing code

    [Theory]
    [InlineData("book-green")]
    [InlineData("book-blue")]
    public void The_cabinet_opens_only_with_this_games_code_read_from_the_arrows_end(string arrow)
    {
        var g = Start(2);
        var world = g.World;
        world.Secrets = new() { ["digit:book-green"] = "7", ["digit:book-red"] = "2", ["digit:book-brown"] = "9", ["digit:book-blue"] = "5", ["arrow"] = arrow };
        GameEngine.SaveWorld(g.R, world, T0);
        Collect(g);
        Map(g);
        Shelve(g);
        Assert.Equal("locked", g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J("7295"), T0).Code);  // the compass first
        WakeCompass(g, 0, T0);
        var right = arrow == "book-green" ? "7295" : "5927";
        var reversed = arrow == "book-green" ? "5927" : "7295";
        Assert.Equal(right, ReadCode(g, arrow));
        Assert.Equal("wrong", g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J("3142"), T0).Code);   // the old fixed code is gone
        Assert.Equal("wrong", g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J(reversed), T0).Code); // the wrong direction
        // three wrong in a row: the lock rests (as every code lock)
        var third = g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J("1111"), T0);
        Assert.Contains("ננעל", third.Message);
        Assert.Equal("cooldown", g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J(right), T0).Code);
        var opened = g.E.SubmitAnswer(g.R, g.Ps[1].Id, "g1-cabinet", J(right), T0.AddSeconds(25));
        Assert.Equal("solved", opened.Code);
        Assert.Contains("gs-golden-key", g.World.Inventory);
        Assert.Equal("gearworks", g.World.PendingZone);
        // the code never travels to the players
        Assert.DoesNotContain($"\"{right}\"", Snapshot(g, T0.AddSeconds(26)));
    }

    // ------------------------------------------------------------------ the whole room, alone and in groups

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void Room_1_is_played_through_by_one_two_or_four_players(int players)
    {
        var g = Start(players, "ROOM" + players + "Z");
        PlayRoom1(g);
        Assert.Equal(PuzzleStatus.Solved, g.Status("g1-cabinet"));
        Assert.Contains("gs-golden-key", g.World.Inventory);
        Assert.True(g.E.Continue(g.R, g.Ps[0].Id, T0.AddSeconds(2)).Ok);
        Assert.Equal(PuzzleStatus.Active, g.Status("g2-pipes"));
        // scored once: the room's group points, and no action counted twice
        var log = g.World.Score!.Log;
        Assert.Equal(log.Count, log.Select(x => x.Key).Distinct().Count());
        Assert.Single(log, x => x.Key == "room:maproom");
        Assert.Equal(100, g.World.Score.Rooms["maproom"]);
        Assert.Single(log, x => x.Key == "mechanism:g1-compass");
        Assert.Single(log, x => x.Key == "answer:g1-cabinet");
        // everyone who played has points
        Assert.All(g.Ps, p => Assert.True(g.World.Score.Personal.GetValueOrDefault(p.Id.ToString()) > 0));
    }

    [Fact]
    public void A_hint_costs_the_room_ten_points()
    {
        var g = Start(1);
        Collect(g);
        Assert.True(g.E.RequestHint(g.R, g.Ps[0].Id, "g1-map", T0).Ok);
        Map(g);
        Shelve(g);
        WakeCompass(g, 0, T0);
        g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-cabinet", J(ReadCode(g, g.World.Secrets!["arrow"])), T0);
        Assert.Equal(90, g.World.Score!.Rooms["maproom"]);
    }

    // ------------------------------------------------------------------ the other games are untouched

    [Theory]
    [InlineData("hanukkah-oil")]
    [InlineData("stone-maze")]
    [InlineData("last-portal")]
    public void Other_games_draw_no_secrets_and_their_saved_state_has_no_new_field(string scenario)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom(scenario, "OTHER1", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < 2; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "o" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        e.SetReady(r, ps[1].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.Null(GameEngine.World(r).Secrets);
        Assert.DoesNotContain("secrets", r.WorldJson, StringComparison.OrdinalIgnoreCase);
        var c = Catalog.Get(scenario);
        Assert.DoesNotContain(c.Puzzles, p => p.Type == "compass" || p.PublicData["checkWhole"] != null
            || p.PublicData["generatedBacks"] != null || p.Solution["generatedFrom"] != null);
    }
}
