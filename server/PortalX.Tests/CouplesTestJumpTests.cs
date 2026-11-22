using PortalX.Server.Domain;
using PortalX.Server.Game;
using static PortalX.Tests.GameEngineTests;

namespace PortalX.Tests;

/// <summary>The local-preview jump to a later room: off by default, forward only, and it leaves the game as if played.</summary>
public class CouplesTestJumpTests
{
    private static readonly DateTime T0 = new(2026, 12, 20, 19, 0, 0, DateTimeKind.Utc);

    private static (GameEngine E, GameRoom R, PlayerSession P) Start(bool jumps)
    {
        var e = new GameEngine(Catalog, new GameOptions { TestJumps = jumps });
        var r = e.CreateRoom("couples-cipher", "JUMP" + (jumps ? 1 : 0), "hash", T0);
        Assert.True(e.AddPlayer(r, "בודק", GameEngine.Characters[0], "{}", "cj", true, T0, out var p).Ok);
        p!.IsConnected = true;
        Assert.True(e.StartGame(r, p.Id, T0).Ok);
        Assert.True(e.FinishIntro(r, p.Id, true, T0).Ok);
        return (e, r, p);
    }

    [Fact]
    public void The_jump_is_refused_unless_the_test_option_is_on()
    {
        var (e, r, p) = Start(false);
        var res = e.TestJump(r, p.Id, "cc-home", T0);
        Assert.False(res.Ok);
        Assert.Equal("not-allowed", res.Code);
        Assert.Equal("cc-sounds", e.CurrentZone(r).Zone);
    }

    [Theory]
    [InlineData("cc-partnership")]
    [InlineData("cc-trust")]
    [InlineData("cc-letters")]
    [InlineData("cc-home")]
    public void A_jump_reaches_the_room_with_every_earlier_room_solved_and_its_own_puzzles_open(string zone)
    {
        var (e, r, p) = Start(true);
        var cc = Catalog.Get("couples-cipher");
        Assert.True(e.TestJump(r, p.Id, zone, T0).Ok);
        Assert.Equal(zone, e.CurrentZone(r).Zone);
        Assert.Equal(RoomPhase.Playing, r.Phase);
        var order = cc.Zones.First(z => z.Id == zone).Order;
        foreach (var pz in cc.Puzzles.Where(x => !x.Bonus))
        {
            var st = r.Puzzles.First(x => x.PuzzleId == pz.Id).Status;
            var zo = cc.Zones.First(z => z.Id == pz.Zone).Order;
            if (zo < order) Assert.Equal(PuzzleStatus.Solved, st);
            else if (zo > order) Assert.Equal(PuzzleStatus.Locked, st);
        }
        Assert.Contains(cc.Puzzles, x => x.Zone == zone && r.Puzzles.First(s => s.PuzzleId == x.Id).Status == PuzzleStatus.Active);
        // the rewards of the rooms behind are in the bag, as after playing them
        var world = GameEngine.World(r);
        foreach (var reward in cc.Puzzles.Where(x => cc.Zones.First(z => z.Id == x.Zone).Order < order && x.RewardItem != null).Select(x => x.RewardItem!))
            Assert.True(world.Inventory.Contains(reward) || world.Mechanisms.Values.Any(m => m.Slots.ContainsValue(reward)), reward);
        Assert.Null(world.PendingZone);
    }

    [Fact]
    public void A_jump_goes_forward_only()
    {
        var (e, r, p) = Start(true);
        Assert.True(e.TestJump(r, p.Id, "cc-letters", T0).Ok);
        Assert.Equal("behind", e.TestJump(r, p.Id, "cc-trust", T0).Code);
        Assert.Equal("behind", e.TestJump(r, p.Id, "cc-letters", T0).Code);
        Assert.Equal("unknown-zone", e.TestJump(r, p.Id, "nowhere", T0).Code);
    }
}
