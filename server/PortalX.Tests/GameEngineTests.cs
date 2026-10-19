using System.Text.Json;
using PortalX.Server.Content;
using PortalX.Server.Domain;
using PortalX.Server.Game;

namespace PortalX.Tests;

public class GameEngineTests
{
    internal static readonly ScenarioCatalog Catalog = ScenarioCatalog.LoadDefault();
    private static DateTime T0 => new(2026, 1, 1, 10, 0, 0, DateTimeKind.Utc);

    internal static (GameEngine engine, GameRoom room, List<PlayerSession> players) Setup(int count = 4, GameOptions? options = null)
    {
        var engine = new GameEngine(Catalog, options ?? new GameOptions());
        var room = engine.CreateRoom("last-portal", "ABC234", "hash", T0);
        var players = new List<PlayerSession>();
        string[] names = ["ישראל", "דוד", "אורי", "משה", "יונתן", "נתן", "שמואל", "אליהו"];
        for (var i = 0; i < count; i++)
        {
            var r = engine.AddPlayer(room, names[i], GameEngine.Characters[i % 4], "{\"skin\":1}", "t" + i, i == 0, T0, out var p);
            Assert.True(r.Ok, r.Message);
            p!.IsConnected = true;
            players.Add(p);
        }
        return (engine, room, players);
    }

    internal static JsonElement J(object o) => JsonSerializer.SerializeToElement(o);

    internal static void StartPlaying(GameEngine engine, GameRoom room, List<PlayerSession> players)
    {
        foreach (var p in players.Skip(1)) Assert.True(engine.SetReady(room, p.Id, true).Ok);
        var start = engine.StartGame(room, players[0].Id, T0);
        Assert.True(start.Ok, start.Message);
        Assert.Equal(RoomPhase.Intro, room.Phase);
        Assert.True(engine.FinishIntro(room, players[0].Id, skip: true, T0.AddSeconds(3)).Ok);
        Assert.Equal(RoomPhase.Playing, room.Phase);
    }

    [Fact]
    public void Full_playthrough_with_four_players_completes_and_builds_result()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        var t = T0.AddMinutes(1);

        Assert.True(engine.PickUp(room, ps[3].Id, "handle", t).Ok);
        Assert.Equal("solved", engine.SubmitAnswer(room, ps[1].Id, "p1-cipher", J("שער"), t).Code);
        Assert.Contains("symbols", engine.UnlockedZones(room, Catalog.Get("last-portal")));
        Assert.Equal("solved", engine.SubmitAnswer(room, ps[2].Id, "p2-sequence", J(new[] { "sun", "crown", "leaf", "star" }), t).Code);
        Assert.Equal("solved", engine.SubmitAnswer(room, ps[0].Id, "p3-sound", J(new[] { "gimel", "aleph", "dalet", "aleph", "bet" }), t).Code);
        Assert.True(engine.PickUp(room, ps[2].Id, "crystal", t).Ok);
        Assert.Equal("solved", engine.SubmitAnswer(room, ps[3].Id, "p4-split", J("749"), t).Code);
        Assert.True(engine.PickUp(room, ps[1].Id, "gear", t).Ok);
        Assert.True(engine.Combine(room, ps[0].Id, "handle", "gear", t).Ok);
        Assert.True(engine.PlaceItem(room, ps[1].Id, "p5-items", "crystal", t).Ok);
        Assert.Equal("solved", engine.PlaceItem(room, ps[2].Id, "p5-items", "mechanism", t).Code);

        var world = GameEngine.World(room);
        Assert.Equal(5, world.Letters.Count);
        var final = engine.SubmitAnswer(room, ps[0].Id, "p6-final", J(new[] { "א", "מ", "ו", "נ", "ה" }), T0.AddMinutes(20));
        Assert.Equal("solved", final.Code);
        Assert.Contains(final.Notices, n => n.Kind == "game-completed");
        Assert.Equal(RoomPhase.Completed, room.Phase);

        var result = engine.BuildResult(room);
        Assert.Equal(6, result.PuzzlesSolved);
        Assert.Equal(4, result.PlayersCount);
        Assert.Equal(19 * 60 + 57, result.DurationSeconds);
        Assert.Contains("\"no-hints\"", result.AchievementsJson);
        Assert.Contains("\"everyone\"", result.AchievementsJson);
        Assert.Contains("\"fast\"", result.AchievementsJson);
    }

    [Fact]
    public void Wrong_answers_do_not_advance_and_trigger_cooldown_after_three()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        var t = T0.AddMinutes(1);
        for (var i = 0; i < 3; i++)
        {
            var r = engine.SubmitAnswer(room, ps[0].Id, "p1-cipher", J("דלת"), t);
            Assert.Equal("wrong", r.Code);
        }
        Assert.DoesNotContain("symbols", engine.UnlockedZones(room, Catalog.Get("last-portal")));
        Assert.Equal("cooldown", engine.SubmitAnswer(room, ps[1].Id, "p1-cipher", J("שער"), t.AddSeconds(5)).Code);
        Assert.Equal("solved", engine.SubmitAnswer(room, ps[1].Id, "p1-cipher", J("שער"), t.AddSeconds(25)).Code);
    }

    [Fact]
    public void Already_solved_puzzle_cannot_be_solved_twice()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        Assert.Equal("solved", engine.SubmitAnswer(room, ps[0].Id, "p1-cipher", J("שער"), T0).Code);
        Assert.Equal("already-solved", engine.SubmitAnswer(room, ps[1].Id, "p1-cipher", J("שער"), T0).Code);
        Assert.Single(GameEngine.World(room).Letters);
    }

    [Fact]
    public void Locked_puzzles_reject_answers()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        Assert.Equal("locked", engine.SubmitAnswer(room, ps[0].Id, "p6-final", J("אמונה"), T0).Code);
        Assert.Equal("locked", engine.SubmitAnswer(room, ps[0].Id, "p2-sequence", J(new[] { "sun", "crown", "leaf", "star" }), T0).Code);
    }

    [Fact]
    public void Start_requires_host_minimum_players_and_readiness()
    {
        var (engine, room, ps) = Setup(3);
        Assert.Equal("not-host", engine.StartGame(room, ps[1].Id, T0).Code);
        Assert.Equal("not-ready", engine.StartGame(room, ps[0].Id, T0).Code); // only 3 of minimum 4

        var (engine4, room4, ps4) = Setup(4);
        Assert.Equal("not-ready", engine4.StartGame(room4, ps4[0].Id, T0).Code); // nobody ready
        foreach (var p in ps4.Skip(1)) engine4.SetReady(room4, p.Id, true);
        Assert.True(engine4.StartGame(room4, ps4[0].Id, T0).Ok);
        Assert.Equal("game-started", engine4.AddPlayer(room4, "מאוחר", "explorer", "{}", "late", false, T0, out _).Code);
    }

    [Fact]
    public void Intro_cannot_be_ended_early_by_non_host()
    {
        var (engine, room, ps) = Setup();
        foreach (var p in ps.Skip(1)) engine.SetReady(room, p.Id, true);
        engine.StartGame(room, ps[0].Id, T0);
        Assert.Equal("not-host", engine.FinishIntro(room, ps[1].Id, true, T0.AddSeconds(2)).Code);
        Assert.Equal("too-early", engine.FinishIntro(room, ps[1].Id, false, T0.AddSeconds(10)).Code);
        Assert.True(engine.FinishIntro(room, ps[1].Id, false, T0.AddSeconds(60)).Ok);
    }

    [Fact]
    public void Hints_are_revealed_in_three_levels()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        for (var i = 1; i <= 3; i++) Assert.True(engine.RequestHint(room, ps[i % 4].Id, "p1-cipher", T0).Ok);
        Assert.Equal("no-more-hints", engine.RequestHint(room, ps[0].Id, "p1-cipher", T0).Code);
        var snap = Snapshots.Build(engine, room, null, T0);
        Assert.Equal(3, snap.Puzzles.First(p => p.Id == "p1-cipher").Hints.Count);
        Assert.Empty(snap.Puzzles.First(p => p.Id == "p2-sequence").Hints);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(8)]
    public void Split_clues_cover_all_pieces_and_differ_between_players(int count)
    {
        var (engine, room, ps) = Setup(count, new GameOptions { MinPlayersOverride = 1 });
        var puzzle = Catalog.Get("last-portal").Puzzle("p4-split");
        var all = ps.SelectMany(p => engine.CluesForPlayer(room, puzzle, p.Id).Select(c => c.Index)).Distinct().ToList();
        Assert.Equal(3, all.Count);
        if (count >= 3)
        {
            Assert.All(ps, p => Assert.Single(engine.CluesForPlayer(room, puzzle, p.Id)));
            Assert.NotEqual(engine.CluesForPlayer(room, puzzle, ps[0].Id)[0].Index, engine.CluesForPlayer(room, puzzle, ps[1].Id)[0].Index);
        }
    }

    [Fact]
    public void Cipher_key_is_split_so_two_players_must_cooperate()
    {
        var (engine, room, ps) = Setup(2, new GameOptions { MinPlayersOverride = 2 });
        var puzzle = Catalog.Get("last-portal").Puzzle("p1-cipher");
        var message = puzzle.PublicData["message"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var a = engine.KeyForPlayer(room, puzzle, ps[0].Id).Select(k => k.Symbol).ToList();
        var b = engine.KeyForPlayer(room, puzzle, ps[1].Id).Select(k => k.Symbol).ToList();
        Assert.NotEmpty(a);
        Assert.NotEmpty(b);
        Assert.Empty(a.Intersect(b));
        Assert.False(message.All(a.Contains), "player 1 must not be able to decode alone");
        Assert.False(message.All(b.Contains), "player 2 must not be able to decode alone");
        Assert.True(message.All(s => a.Contains(s) || b.Contains(s)), "together they can decode");
    }

    [Fact]
    public void Cipher_key_with_four_players_gives_each_pair_a_different_half()
    {
        var (engine, room, ps) = Setup(4);
        var puzzle = Catalog.Get("last-portal").Puzzle("p1-cipher");
        var halves = ps.Select(p => string.Join(",", engine.KeyForPlayer(room, puzzle, p.Id).Select(k => k.Symbol))).ToList();
        Assert.Equal(halves[0], halves[2]);
        Assert.Equal(halves[1], halves[3]);
        Assert.NotEqual(halves[0], halves[1]);
    }

    [Fact]
    public void Solo_player_receives_the_whole_key()
    {
        var (engine, room, ps) = Setup(1, new GameOptions { MinPlayersOverride = 1 });
        var puzzle = Catalog.Get("last-portal").Puzzle("p1-cipher");
        Assert.Equal(8, engine.KeyForPlayer(room, puzzle, ps[0].Id).Count);
    }

    [Fact]
    public void Personal_key_is_delivered_only_through_the_personal_channel()
    {
        var (engine, room, ps) = Setup(2, new GameOptions { MinPlayersOverride = 2 });
        StartPlaying(engine, room, ps);
        var r = engine.GetPersonalClues(room, ps[0].Id, "p1-cipher", T0);
        Assert.True(r.Ok, r.Message);
        Assert.Equal(4, r.Data!["key"]!.AsArray().Count);
        Assert.Equal("not-in-room", engine.GetPersonalClues(room, Guid.NewGuid(), "p1-cipher", T0).Code);
    }

    [Fact]
    public void Item_rules_are_enforced()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        Assert.Equal("item-missing", engine.PickUp(room, ps[0].Id, "gear", T0).Code); // not revealed yet
        Assert.True(engine.PickUp(room, ps[0].Id, "handle", T0).Ok);
        Assert.Equal("item-missing", engine.PickUp(room, ps[1].Id, "handle", T0).Code); // already taken
        Assert.Equal("zone-locked", engine.Combine(room, ps[0].Id, "handle", "gear", T0).Code);
    }

    [Theory]
    [InlineData("שער", true)]
    [InlineData(" ש ע ר ", true)]
    [InlineData("שַׁעַר", true)]
    [InlineData("שעד", false)]
    public void Text_answers_are_normalized(string given, bool ok)
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        Assert.Equal(ok ? "solved" : "wrong", engine.SubmitAnswer(room, ps[0].Id, "p1-cipher", J(given), T0).Code);
    }

    [Fact]
    public void Final_letters_are_equivalent_to_regular_letters()
    {
        Assert.Equal(GameEngine.NormalizeText("שלום"), GameEngine.NormalizeText("שלומ"));
    }

    [Fact]
    public void Public_scenario_does_not_leak_solutions()
    {
        var json = Snapshots.PublicScenario(Catalog.Get("last-portal")).ToJsonString();
        Assert.DoesNotContain("solution", json);
        Assert.DoesNotContain("personalClues", json);
        Assert.DoesNotContain("749", json);
        Assert.DoesNotContain("gimel\",\"aleph\",\"dalet", json);
        Assert.DoesNotContain("finalWord", json);
        Assert.DoesNotContain("personalKey", json);
        Assert.DoesNotContain("\"letter\":\"ש\"", json);
    }

    [Theory]
    [InlineData("א", false)]
    [InlineData("מנחם", true)]
    [InlineData("Yossi 2", true)]
    [InlineData("<script>", false)]
    [InlineData("טיפש", false)]
    [InlineData("שם ארוך מאוד מאוד מאוד", false)]
    public void Nicknames_are_validated(string name, bool ok) => Assert.Equal(ok, GameEngine.ValidateNickname(name) == null);

    [Theory]
    [InlineData("מצאתי רמז ליד המדף", true)]
    [InlineData("אתה טיפש", false)]
    [InlineData("היכנסו ל www.example.com", false)]
    [InlineData("הטלפון שלי 050-1234567", false)]
    public void Chat_filter_keeps_language_clean(string text, bool ok) => Assert.Equal(ok, ContentFilter.Check(text) == null);

    [Fact]
    public void Play_again_resets_progress_and_returns_to_lobby()
    {
        var (engine, room, ps) = Setup();
        StartPlaying(engine, room, ps);
        engine.SubmitAnswer(room, ps[0].Id, "p1-cipher", J("שער"), T0);
        Assert.Equal("not-finished", engine.PlayAgain(room, ps[0].Id, T0).Code);
        room.Phase = RoomPhase.Completed;
        Assert.True(engine.PlayAgain(room, ps[0].Id, T0).Ok);
        Assert.Equal(RoomPhase.Lobby, room.Phase);
        Assert.Equal(1, room.Round);
        Assert.All(room.Puzzles, p => Assert.NotEqual(PuzzleStatus.Solved, p.Status));
        Assert.Empty(GameEngine.World(room).Letters);
    }

    [Fact]
    public void Host_passes_to_next_player_when_host_leaves_lobby()
    {
        var (engine, room, ps) = Setup();
        engine.Leave(room, ps[0].Id, T0);
        Assert.Equal(ps[1].Id, room.HostPlayerId);
    }

    [Fact]
    public void Appearance_is_sanitized()
    {
        Assert.Equal("{\"skin\":2}", GameEngine.SanitizeAppearance("{\"skin\":2,\"evil\":\"<x>\",\"hair\":99}"));
        Assert.Equal("{}", GameEngine.SanitizeAppearance("not json"));
    }
}
