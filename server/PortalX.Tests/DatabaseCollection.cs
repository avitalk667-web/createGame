namespace PortalX.Tests;

/// <summary>
/// All tests that use the real portalx_test database share one server and run one class at a time,
/// so the migrations run once and tests don't race each other on shared rows.
/// </summary>
[CollectionDefinition(Name)]
public sealed class DatabaseCollection : ICollectionFixture<HubIntegrationTests.Factory>
{
    public const string Name = "database";
}
