using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>
/// "מבוך האבן": two rooms, and each is left only through its door at the very end. Solving the pendulum, the map or
/// the rune chain never opens a room; the stone door opens only when the whole room is done AND the ancient key (found in
/// the cabinet, puzzle 3) is in the group's bag. The
/// server enforces it whatever a client sends. The paid games keep their own way of opening rooms.
/// </summary>
public class StoneMazeDoorTests
{
    private static readonly DateTime T0 = new(2026, 12, 14, 18, 0, 0, DateTimeKind.Utc);
    private const string Key = "gs-golden-key";

    /// <summary>A tampered state for the bypass tests: the ancient key put straight into the group's bag.</summary>
    public static void KeyIntoBag(GameRoom r, DateTime now)
    {
        var w = GameEngine.World(r);
        if (!w.Inventory.Contains(Key)) w.Inventory.Add(Key);
        GameEngine.SaveWorld(r, w, now);
    }

    /// <summary>The door of the Stone Hall with the key from the cabinet, then everyone moves on together.</summary>
    public static void ThroughTheStoneDoor(GameEngine e, GameRoom r, IList<PlayerSession> ps, DateTime now)
    {
        Assert.Contains(Key, GameEngine.World(r).Inventory);
        Assert.Equal("solved", e.Operate(r, ps[^1].Id, "g1-door", J(new { op = "unlock" }), now).Code);
        Assert.True(e.Continue(r, ps[0].Id, now).Ok);
    }

    private sealed record Game(GameEngine E, GameRoom R, List<PlayerSession> Ps)
    {
        public ActionOutcome Door(int who, DateTime at) => E.Operate(R, Ps[who % Ps.Count].Id, "g1-door", J(new { op = "unlock" }), at);
        public WorldState World => GameEngine.World(R);
        public PuzzleState State(string id) => R.Puzzles.First(p => p.PuzzleId == id);
        public HashSet<string> Open => E.UnlockedZones(R, E.Catalog.Get("stone-maze"));
    }

    private static Game Start(int players)
    {
        var e = new GameEngine(Catalog, new GameOptions());
        var r = e.CreateRoom("stone-maze", "DOOR" + players + "X", "hash", T0);
        var ps = new List<PlayerSession>();
        for (var i = 0; i < players; i++)
        {
            Assert.True(e.AddPlayer(r, "שחקן" + i, GameEngine.Characters[i], "{}", "d" + i, i == 0, T0, out var p).Ok);
            p!.IsConnected = true;
            ps.Add(p);
        }
        for (var i = 1; i < players; i++) e.SetReady(r, ps[i].Id, true);
        Assert.True(e.StartGame(r, ps[0].Id, T0).Ok);
        Assert.True(e.FinishIntro(r, ps[0].Id, true, T0).Ok);
        return new Game(e, r, ps);
    }

    // ------------------------------------------------------------------ the rule in the content

    [Fact]
    public void In_the_free_game_only_the_two_doors_open_rooms_and_each_comes_last_in_its_room()
    {
        var c = Catalog.Get("stone-maze");
        Assert.Equal(["maproom", "gearworks"], c.Zones.OrderBy(z => z.Order).Select(z => z.Id).ToArray());
        var openers = c.Puzzles.Where(p => p.UnlocksZone != null).ToList();
        var door = Assert.Single(openers);
        Assert.Equal(("g1-door", "exitdoor", "gearworks"), (door.Id, door.Type, door.UnlocksZone));
        Assert.All(c.Puzzles.Where(p => p.Zone == "maproom" && p.Id != door.Id), p => Assert.True(p.Order < door.Order));
        Assert.Equal(Key, door.PublicData["needsItem"]!.GetValue<string>());
        // three puzzles in each room (plus the optional chest in the first), and exactly two doors in the whole game
        // (puzzle 1, "הקפאה והפשרה", is two steps on the server: the pendulum and the map it frees)
        Assert.Equal(["g1-pendulum", "g1-map", "g1-runes", "g1-cabinet"], c.Puzzles.Where(p => p.Zone == "maproom" && p.Type != "exitdoor" && !p.Bonus).Select(p => p.Id).ToArray());
        Assert.Equal(["g2-levers", "g2-rails", "g2-gravity"], c.Puzzles.Where(p => p.Zone == "gearworks" && p.Type != "exitdoor").Select(p => p.Id).ToArray());
        Assert.True(c.Puzzle("g1-chest").Bonus);
        var gate = Assert.Single(c.Puzzles.Where(p => p.Zone == "gearworks" && p.Type == "exitdoor"));
        Assert.Null(gate.UnlocksZone);                              // the exit gate opens no room: it ends the game
        Assert.Equal(2, c.Puzzles.Count(p => p.Type == "exitdoor"));
    }

    [Fact]
    public void A_free_game_puzzle_that_tried_to_open_a_room_would_stop_the_server_at_start()
    {
        var dir = Path.Combine(Path.GetTempPath(), "px-door-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var src = Path.Combine(AppContext.BaseDirectory, "Content", "scenarios", "stone-maze.he.json");
            var json = JsonNode.Parse(File.ReadAllText(src))!;
            json["puzzles"]!.AsArray().First(p => p!["id"]!.GetValue<string>() == "g1-map")!["unlocksZone"] = "gearworks";
            File.WriteAllText(Path.Combine(dir, "stone-maze.he.json"), json.ToJsonString());
            var ex = Assert.Throws<InvalidDataException>(() => ScenarioCatalog.LoadFrom(dir));
            Assert.Contains("only the room's door may open the next room", ex.Message);
        }
        finally { Directory.Delete(dir, true); }
    }

    [Fact]
    public void The_paid_games_keep_opening_rooms_their_own_way()
    {
        foreach (var id in new[] { "hanukkah-oil", "last-portal" })
        {
            var c = Catalog.Get(id);
            Assert.DoesNotContain(c.Puzzles, p => p.Type == "exitdoor");
        }
        Assert.Contains(Catalog.Get("hanukkah-oil").Puzzles, p => p.UnlocksZone != null && p.Type != "exitdoor");
    }

    // ------------------------------------------------------------------ never early

    [Fact]
    public void Neither_the_pendulum_nor_the_map_nor_the_runes_open_the_door()
    {
        var g = Start(2);
        Assert.Equal(PuzzleStatus.Locked, g.State("g1-door").Status);
        Assert.Equal("locked", g.Door(0, T0).Code);
        // play puzzle by puzzle, checking after each that nothing opened
        var t = T0;
        Assert.True(g.E.DiscoverClue(g.R, g.Ps[0].Id, "g1-entrance", t).Ok);
        for (var round = 0; round < 3; round++)
        {
            g.E.Operate(g.R, g.Ps[0].Id, "g1-pendulum", J(new { op = "start" }), t);
            StoneMazeRoom1Tests.Freeze(g.E, g.R, g.Ps[1], t.AddSeconds(StoneMazeRoom1Tests.HitAt(Catalog.Get("stone-maze").Puzzle("g1-pendulum").PublicData["rounds"]![round]!)), TimeSpan.Zero);
        }
        AssertStillClosed(g, "after the pendulum");
        StoneMazeRoom1Tests.Assemble(g.E, g.R, g.Ps, t);
        AssertStillClosed(g, "after the map");
        StoneMazeRunesTests.PlayRunes(g.E, g.R, g.Ps, t.AddSeconds(2));
        AssertStillClosed(g, "after the rune chain");
        Assert.Equal("locked", g.Door(1, t.AddMinutes(1)).Code);   // the door waits for the cabinet
        StoneMazeRoom1Tests.OpenCabinet(g.E, g.R, g.Ps, t.AddMinutes(1));
        AssertStillClosed(g, "after the cabinet (the key is in the bag, nobody used it yet)");
        Assert.Contains(Key, g.World.Inventory);
        Assert.Equal("noop", g.E.Continue(g.R, g.Ps[0].Id, t.AddMinutes(1)).Code);
        Assert.Equal("maproom", g.World.CurrentZone ?? "maproom");
        // only the key, used on the door, opens it
        Assert.Equal("solved", g.Door(0, t.AddMinutes(2)).Code);
        Assert.Contains("gearworks", g.Open);
    }

    private static void AssertStillClosed(Game g, string when)
    {
        Assert.False(g.Open.Contains("gearworks"), $"the workshop opened {when}");
        Assert.Null(g.World.PendingZone);
        Assert.NotEqual(PuzzleStatus.Solved, g.State("g1-door").Status);
        Assert.DoesNotContain(g.World.Score?.Log ?? [], e => e.Type == "room" && e.Zone == "maproom");
    }

    [Fact]
    public void The_key_alone_does_not_open_the_door_before_the_room_is_done_even_if_a_client_forces_it()
    {
        var g = Start(1);
        KeyIntoBag(g.R, T0);                                       // a tampered state: the key in the bag from the start
        Assert.Equal("locked", g.Door(0, T0).Code);                // the door step is still locked
        // a tampered state: the door marked open while the room is not done — the server still refuses
        g.State("g1-door").Status = PuzzleStatus.Active;
        var forced = g.Door(0, T0);
        Assert.Equal("room-not-done", forced.Code);
        Assert.False(g.Open.Contains("gearworks"));
        Assert.Null(g.World.PendingZone);
        // other ways in are closed too: answering, placing, continuing
        Assert.False(g.E.SubmitAnswer(g.R, g.Ps[0].Id, "g1-door", J("3142"), T0).Ok);
        Assert.False(g.E.PlaceItem(g.R, g.Ps[0].Id, "g1-door", Key, T0).Ok);
        Assert.Equal("noop", g.E.Continue(g.R, g.Ps[0].Id, T0).Code);
    }

    // ------------------------------------------------------------------ the door at the end, for any group

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(4)]
    public void At_the_end_of_the_room_the_ancient_key_opens_the_door_and_everyone_moves_on_together(int players)
    {
        var g = Start(players);
        var t = StoneMazeRoom1Tests.PlayRoom1(g.E, g.R, g.Ps, T0);
        Assert.Contains(Key, g.World.Inventory);                   // from the cabinet
        AssertStillClosed(g, "after the three puzzles, before the key is used");
        var opened = g.Door(players - 1, t);
        Assert.Equal("solved", opened.Code);
        Assert.Contains("gearworks", g.Open);
        Assert.Equal("gearworks", g.World.PendingZone);
        Assert.Contains(Key, g.World.Inventory);                   // the key is not used up
        Assert.Equal(100, g.World.Score!.Rooms["maproom"]);        // the room's group points come with its door
        Assert.Equal(115, g.World.Score.Personal.Values.Sum());    // the door itself gives no points
        Assert.False(g.Door(0, t).Ok);                             // opening again does nothing
        Assert.True(g.E.Continue(g.R, g.Ps[0].Id, t).Ok);
        Assert.Equal("gearworks", g.World.CurrentZone);
        // everyone sees it: one shared state
        var snap = Snapshots.Build(g.E, g.R, null, t);
        Assert.Equal("gearworks", snap.ActiveZone);
        Assert.Contains("gearworks", snap.UnlockedZones);
    }
}
