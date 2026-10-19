namespace PortalX.Server.Domain;

// Data entities per spec §12.

public class GameScenario
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public string Duration { get; set; } = "";
    public string Difficulty { get; set; } = "";
    public string PuzzleIds { get; set; } = "[]";
    public DateTime UpdatedAt { get; set; }
}

public class PuzzleDefinition
{
    public string Id { get; set; } = "";
    public string ScenarioId { get; set; } = "";
    public int Order { get; set; }
    public string Type { get; set; } = "";
    public string Zone { get; set; } = "";
    public string Title { get; set; } = "";
    public string Instructions { get; set; } = "";
    public string PublicDataJson { get; set; } = "{}";
    public string SolutionJson { get; set; } = "{}";
    public string HintsJson { get; set; } = "[]";
    public string SuccessMessage { get; set; } = "";
    public string FailureMessage { get; set; } = "";
}

public enum RoomPhase { Lobby = 0, Intro = 1, Playing = 2, Completed = 3 }

public class GameRoom
{
    public Guid Id { get; set; }
    public string Code { get; set; } = "";
    public string ScenarioId { get; set; } = "";
    public RoomPhase Phase { get; set; }
    public Guid? HostPlayerId { get; set; }
    /// <summary>SHA-256 of the one-time host claim token handed to the room creator.</summary>
    public string HostClaimHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime? IntroStartedAt { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? EndedAt { get; set; }
    public int Round { get; set; }
    /// <summary>JSON of <see cref="WorldState"/>: inventory, world items, letters, contributions.</summary>
    public string WorldJson { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; }

    public List<PlayerSession> Players { get; set; } = new();
    public List<PuzzleState> Puzzles { get; set; } = new();
}

public class PlayerSession
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public string Nickname { get; set; } = "";
    public string CharacterId { get; set; } = "";
    public string AppearanceJson { get; set; } = "{}";
    public string TokenHash { get; set; } = "";
    public int Seat { get; set; }
    public bool IsReady { get; set; }
    public bool IsConnected { get; set; }
    public string? ConnectionId { get; set; }
    public DateTime JoinedAt { get; set; }
    public DateTime LastSeenAt { get; set; }
    public bool IsRemoved { get; set; }
}

public enum PuzzleStatus { Locked = 0, Active = 1, Solved = 2 }

public class PuzzleState
{
    public Guid RoomId { get; set; }
    public string PuzzleId { get; set; } = "";
    public PuzzleStatus Status { get; set; }
    public int Attempts { get; set; }
    public int WrongStreak { get; set; }
    public DateTime? CooldownUntil { get; set; }
    public int HintsRevealed { get; set; }
    public DateTime? SolvedAt { get; set; }
    public Guid? SolvedByPlayerId { get; set; }
}

public class GameEvent
{
    public long Id { get; set; }
    public Guid RoomId { get; set; }
    public Guid? PlayerId { get; set; }
    public string Type { get; set; } = "";
    public string? ClientActionId { get; set; }
    public string PayloadJson { get; set; } = "{}";
    public string ResultJson { get; set; } = "{}";
    public DateTime CreatedAt { get; set; }
}

public class GameResult
{
    public Guid Id { get; set; }
    public Guid RoomId { get; set; }
    public string ScenarioId { get; set; } = "";
    public int Round { get; set; }
    public int DurationSeconds { get; set; }
    public int PlayersCount { get; set; }
    public int HintsUsed { get; set; }
    public int WrongAttempts { get; set; }
    public int PuzzlesSolved { get; set; }
    public int PuzzlesTotal { get; set; }
    public string AchievementsJson { get; set; } = "[]";
    public string CompletionType { get; set; } = "success";
    public DateTime CreatedAt { get; set; }
}

/// <summary>Group-wide world state stored as JSON on the room.</summary>
public class WorldState
{
    public List<string> Inventory { get; set; } = new();
    public List<string> WorldItems { get; set; } = new();
    public List<string> PlacedItems { get; set; } = new();
    public List<GoldenLetter> Letters { get; set; } = new();
    public Dictionary<string, int> Contributions { get; set; } = new();
}

public record GoldenLetter(string Letter, string Zone);
