using System.Text.Json;
using System.Text.Json.Nodes;
using PortalX.Server.Content;
using PortalX.Server.Domain;

namespace PortalX.Server.Game;

/// <param name="SeatStatus">"connected", "away" (disconnected, seat reserved until SeatHeldUntil) or "released".</param>
public sealed record PlayerDto(Guid Id, string Nickname, string CharacterId, JsonNode? Appearance, int Seat,
    bool IsReady, bool IsConnected, bool IsHost, string SeatStatus = "connected", DateTime? SeatHeldUntil = null);

public sealed record PuzzleStateDto(string Id, string Status, int Attempts, int HintsRevealed, IReadOnlyList<string> Hints,
    DateTime? CooldownUntil, Guid? SolvedBy, DateTime? SolvedAt);

public sealed record ResultDto(int DurationSeconds, int PlayersCount, int HintsUsed, int WrongAttempts, int PuzzlesSolved,
    int PuzzlesTotal, JsonNode? Achievements);

public sealed record RoomSnapshot(
    Guid RoomId, string Code, string ScenarioId, string Phase, int Round, Guid? HostPlayerId,
    IReadOnlyList<PlayerDto> Players, int MinPlayers, int MaxPlayers, string? StartBlocker,
    DateTime? IntroStartedAt, DateTime? StartedAt, DateTime? EndedAt, DateTime ServerNow, int IntroSeconds,
    IReadOnlyList<string> UnlockedZones, IReadOnlyList<PuzzleStateDto> Puzzles,
    IReadOnlyList<string> Inventory, IReadOnlyList<string> WorldItems, IReadOnlyList<string> PlacedItems,
    IReadOnlyList<GoldenLetter> Letters, ResultDto? Result,
    string ActiveZone, DateTime? ActiveZoneSince, int TransitionDelayMs,
    JsonNode? Mechanisms = null, IReadOnlyDictionary<string, string>? Clues = null, ScoreDto? Score = null,
    string? PendingZone = null, DateTime? PendingSince = null, int ContinueFallbackSeconds = 0, int SeatsTaken = 0, int SeatHoldMinutes = 0);

/// <summary>Scores of the current round: personal ranking (with ties), group total, per-room points and hints.</summary>
public sealed record ScoreDto(int Group, IReadOnlyDictionary<string, int> Rooms, IReadOnlyDictionary<string, int> HintsByZone, int HintsUsed,
    IReadOnlyList<PlayerScoreDto> Players, bool Tie);

public sealed record PlayerScoreDto(Guid PlayerId, string Nickname, int Points, int Solved, int Contributions, int Rank);

public static class Snapshots
{
    /// <summary>The group now moves when it presses "Continue"; no timed move after a solve.</summary>
    public const int TransitionDelayMs = 0;

    public static RoomSnapshot Build(GameEngine engine, GameRoom room, GameResult? result, DateTime now)
    {
        var scenario = engine.Catalog.Get(room.ScenarioId);
        var world = GameEngine.World(room);
        var active = ActiveZone(engine, room);
        var players = GameEngine.ActivePlayers(room).OrderBy(p => p.Seat).Select(p =>
        {
            var seat = engine.Seat(p, now);
            return new PlayerDto(p.Id, p.Nickname, p.CharacterId, JsonNode.Parse(p.AppearanceJson), p.Seat, p.IsReady, p.IsConnected,
                p.Id == room.HostPlayerId, seat.ToString().ToLowerInvariant(), seat == GameEngine.SeatState.Away ? engine.SeatHeldUntil(p) : null);
        }).ToList();
        var puzzles = scenario.Puzzles.OrderBy(p => p.Order).Select(pc =>
        {
            var s = room.Puzzles.First(x => x.PuzzleId == pc.Id);
            return new PuzzleStateDto(pc.Id, s.Status.ToString().ToLowerInvariant(), s.Attempts, s.HintsRevealed,
                pc.Hints.Take(s.HintsRevealed).ToList(), s.CooldownUntil > now ? s.CooldownUntil : null, s.SolvedByPlayerId, s.SolvedAt);
        }).ToList();

        return new RoomSnapshot(room.Id, room.Code, room.ScenarioId, room.Phase.ToString().ToLowerInvariant(), room.Round,
            room.HostPlayerId, players, engine.MinPlayers(scenario), engine.MaxPlayers(room),
            room.Phase == RoomPhase.Lobby ? engine.StartBlocker(room) : null,
            room.IntroStartedAt, room.StartedAt, room.EndedAt, now, engine.IntroSeconds(scenario),
            engine.UnlockedZones(room, scenario).ToList(), puzzles,
            world.Inventory, world.WorldItems, world.PlacedItems, world.Letters,
            result == null ? null : new ResultDto(result.DurationSeconds, result.PlayersCount, result.HintsUsed,
                result.WrongAttempts, result.PuzzlesSolved, result.PuzzlesTotal, JsonNode.Parse(result.AchievementsJson)),
            active.Zone, active.Since, TransitionDelayMs,
            world.Mechanisms.Count == 0 ? null : MechanismsView(scenario, world),
            scenario.Clues.Count == 0 ? null : world.Clues,
            scenario.Scoring == null ? null : ScoreView(scenario, room, world),
            world.PendingZone, world.PendingSince, engine.Options.ContinueFallbackSeconds, engine.SeatsTaken(room, now), engine.Options.SeatHoldMinutes);
    }

    /// <summary>Shared mechanism state; the mosaic also gets the cells its light currently reaches.</summary>
    private static JsonNode MechanismsView(ScenarioContent scenario, WorldState world)
    {
        var node = JsonSerializer.SerializeToNode(world.Mechanisms, ScenarioCatalog.JsonOptions)!.AsObject();
        foreach (var p in scenario.Puzzles.Where(p => p.Type == "mosaic" && world.Mechanisms.ContainsKey(p.Id)))
        {
            var (cells, reached) = GameEngine.TraceLight(p.PublicData, world.Mechanisms[p.Id].Rotations);
            node[p.Id]!["lit"] = JsonSerializer.SerializeToNode(cells);
            node[p.Id]!["reached"] = reached;
        }
        return node;
    }

    private static ScoreDto ScoreView(ScenarioContent scenario, GameRoom room, WorldState world)
    {
        var board = world.Score ?? new ScoreBoard();
        var hintsByZone = scenario.Zones.ToDictionary(z => z.Id,
            z => scenario.Puzzles.Where(p => p.Zone == z.Id).Sum(p => room.Puzzles.FirstOrDefault(s => s.PuzzleId == p.Id)?.HintsRevealed ?? 0));
        var ranking = GameEngine.Ranking(room, world);
        var players = ranking.Select(r => new PlayerScoreDto(r.Player.Id, r.Player.Nickname, r.Points, r.Solved,
            world.Contributions.GetValueOrDefault(r.Player.Id.ToString()), r.Rank)).ToList();
        return new ScoreDto(board.Group, board.Rooms, hintsByZone, hintsByZone.Values.Sum(), players,
            players.Count(p => p.Rank == 1) > 1);
    }

    /// <summary>
    /// The room the whole group is in. It changes only when the group presses "Continue", so every client moves
    /// at the same moment, and players who join late or reconnect land there too.
    /// </summary>
    public static (string Zone, DateTime? Since) ActiveZone(GameEngine engine, GameRoom room) => engine.CurrentZone(room);

    /// <summary>Scenario content safe for clients: solutions, personal clues and unrevealed hints are removed (spec §19).</summary>
    public static JsonObject PublicScenario(ScenarioContent s)
    {
        var node = JsonSerializer.SerializeToNode(s, ScenarioCatalog.JsonOptions)!.AsObject();
        node.Remove("finalWord");
        foreach (var p in node["puzzles"]!.AsArray())
        {
            var o = p!.AsObject();
            o.Remove("solution");
            o.Remove("personalClues");
            o.Remove("personalKey");
            // only how many official hints exist; their texts are revealed one by one on request
            o["hintCount"] = o["hints"]?.AsArray().Count ?? 0;
            o.Remove("hints");
        }
        return node;
    }
}
