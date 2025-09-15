import { ResultMap, GameNode, Round, Competition } from './types'

// REPOSITORY AGGREGATOR - Manages all data access
export class FixtureRepositories {
    constructor(
        public gradeRepo: GradeRepository,
        public gameRepo: GameRepository,
        public competitionRepo: CompetitionRepository,
        public roundRepo: RoundRepository,
        public teamRepo: TeamRepository,
        public persistService: FixturePersistService,
    ) {}
}

// GRADE REPOSITORY - Handles grade-related queries
export class GradeRepository {
  constructor(private postgresAdapter: PostgresAdapter) {}

  // QUERY TYPE: Existence check using indexed field
  async hasFixtures(gradeIDs: string[]): Promise<ResultMap<boolean>> {
    const placeholders = gradeIDs.map((_, i) => `$${i + 1}`).join(', ')
    const query = `
      SELECT g.id as grade_id, 
             CASE WHEN COUNT(ga.id) > 0 THEN 1 ELSE 0 END as has_fixture
      FROM grades g
      LEFT JOIN rounds r ON g.id = r.grade_id
      LEFT JOIN games ga ON r.id = ga.round_id
      WHERE g.id IN (${placeholders})
      GROUP BY g.id
    `

    // PERFORMANCE NOTE: Uses primary index on grades.id
    // LEFT JOINs allow for efficient existence checking
    const result = await this.postgresAdapter.query(query, gradeIDs)

    return result.rows.reduce((acc, row) => {
      acc[row.grade_id] = Boolean(row.has_fixture)
      return acc
    }, {})
  }

  // QUERY TYPE: JOIN with manual aggregation
  async findByTeamIDs(teamIDs: string[]): Promise<ResultMap<string[]>> {
    const placeholders = teamIDs.map((_, i) => `$${i + 1}`).join(', ')
    const query = `
      SELECT g.id as grade_id, t.id as team_id
      FROM teams t
      JOIN grades g ON t.grade_id = g.id
      WHERE t.id IN (${placeholders})
      ORDER BY g.id, t.id
    `

    const result = await this.postgresAdapter.query(query, teamIDs)

    // Manual aggregation in application code
    const grouped: ResultMap<string[]> = {}
    result.rows.forEach(row => {
      if (!grouped[row.grade_id]) {
        grouped[row.grade_id] = []
      }
      grouped[row.grade_id].push(row.team_id)
    })
    return grouped
  }

  // QUERY TYPE: Filter by foreign key relationship
  async findBySeasonID(seasonID: string): Promise<any[]> {
    const query = `
      SELECT g.*
      FROM grades g
      WHERE g.season_id = $1
    `

    const result = await this.postgresAdapter.query(query, [seasonID])
    return result.rows
  }

  // QUERY TYPE: Filter by season and grade codes (for validation)
  async findBySeasonIDAndCodes(seasonID: string, gradeCodes: string[]): Promise<any[]> {
    const placeholders = gradeCodes.map((_, i) => `$${i + 2}`).join(', ')
    const query = `
      SELECT g.*
      FROM grades g
      WHERE g.season_id = $1 AND g.code IN (${placeholders})
    `

    const result = await this.postgresAdapter.query(query, [seasonID, ...gradeCodes])
    return result.rows
  }

  // QUERY TYPE: Check fixtures by grade codes (for validation)
  async hasFixturesByCode(gradeCodes: string[]): Promise<{ [gradeCode: string]: boolean }> {
    const placeholders = gradeCodes.map((_, i) => `$${i + 1}`).join(', ')
    const query = `
      SELECT g.code as grade_code,
             CASE WHEN COUNT(ga.id) > 0 THEN 1 ELSE 0 END as has_fixture
      FROM grades g
      LEFT JOIN rounds r ON g.id = r.grade_id
      LEFT JOIN games ga ON r.id = ga.round_id
      WHERE g.code IN (${placeholders})
      GROUP BY g.code
    `

    const result = await this.postgresAdapter.query(query, gradeCodes)

    return result.rows.reduce((acc, row) => {
      acc[row.grade_code] = Boolean(row.has_fixture)
      return acc
    }, {})
  }
}

// GAME REPOSITORY - Handles game-related queries
export class GameRepository {
  constructor(private postgresAdapter: PostgresAdapter) {}

  // QUERY TYPE: Multi-level JOIN with manual aggregation
  async findByGradeIDs(gradeIDs: string[]): Promise<ResultMap<GameNode[]>> {
    const placeholders = gradeIDs.map((_, i) => `$${i + 1}`).join(', ')
    const query = `
      SELECT r.grade_id,
             g.id,
             g.home_team_id,
             g.away_team_id,
             g.date,
             g.provisional_dates
      FROM games g
      JOIN rounds r ON g.round_id = r.id
      WHERE r.grade_id IN (${placeholders})
      ORDER BY r.grade_id, g.id
    `

    // PERFORMANCE: Uses indexes on rounds.grade_id and games.round_id
    // Manual aggregation allows for standard SQL compatibility
    const result = await this.postgresAdapter.query(query, gradeIDs)

    // Manual aggregation in application code
    const grouped: ResultMap<GameNode[]> = {}
    result.rows.forEach(row => {
      if (!grouped[row.grade_id]) {
        grouped[row.grade_id] = []
      }
      grouped[row.grade_id].push({
        id: row.id,
        gradeID: row.grade_id,
        homeTeamID: row.home_team_id,
        awayTeamID: row.away_team_id,
        date: row.date,
        provisionalDates: row.provisional_dates ? JSON.parse(row.provisional_dates) : []
      })
    })
    return grouped
  }

  // QUERY TYPE: Bulk update using individual queries
  async updateGameDates(gameUpdates: { gameID: string; newDate: string }[]): Promise<void> {
    // Use individual UPDATE statements for maximum SQL compatibility
    for (const update of gameUpdates) {
      const query = `
        UPDATE games 
        SET date = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `
      await this.postgresAdapter.query(query, [update.gameID, update.newDate])
    }
  }
}

// COMPETITION REPOSITORY - Handles competition queries
export class CompetitionRepository {
  constructor(private postgresAdapter: PostgresAdapter) {}

  // QUERY TYPE: Direct foreign key lookup with index usage
  async findBySeasonID(seasonID: string): Promise<Competition | null> {
    const query = `
      SELECT c.*
      FROM competitions c
      WHERE c.season_id = $1
      LIMIT 1
    `

    // PERFORMANCE: Uses index on competitions.season_id, relationship is 1:1
    const result = await this.postgresAdapter.query(query, [seasonID])

    return result.rows.length > 0 ? (result.rows[0] as Competition) : null
  }
}

// ROUND REPOSITORY - Handles round-related queries
export class RoundRepository {
  constructor(private postgresAdapter: PostgresAdapter) {}

  // QUERY TYPE: Foreign key query with ordering and manual aggregation
  async findByGradeIDs(gradeIDs: string[]): Promise<ResultMap<Round[]>> {
    const placeholders = gradeIDs.map((_, i) => `$${i + 1}`).join(', ')
    const query = `
      SELECT r.*
      FROM rounds r
      WHERE r.grade_id IN (${placeholders})
      ORDER BY r.grade_id, r.sequence_no
    `

    const result = await this.postgresAdapter.query(query, gradeIDs)

    // Manual aggregation in application code
    const grouped: ResultMap<Round[]> = {}
    result.rows.forEach(row => {
      if (!grouped[row.grade_id]) {
        grouped[row.grade_id] = []
      }
      grouped[row.grade_id].push(row)
    })
    return grouped
  }

  // QUERY TYPE: Single foreign key lookup with ordering
  async findByGradeID(gradeID: string): Promise<Round[]> {
    const query = `
      SELECT r.*
      FROM rounds r
      WHERE r.grade_id = $1
      ORDER BY r.sequence_no
    `

    const result = await this.postgresAdapter.query(query, [gradeID])
    return result.rows
  }
}

// TEAM REPOSITORY - Handles team-related queries
export class TeamRepository {
    constructor(private postgresAdapter: PostgresAdapter) {}

    // QUERY TYPE: Find teams by season (for validation)
    async findBySeasonID(seasonID: string): Promise<any[]> {
        const query = `
          SELECT t.*, t.grade_id as "gradeID"
          FROM teams t
          JOIN grades g ON t.grade_id = g.id
          WHERE g.season_id = $1
        `

        const result = await this.postgresAdapter.query(query, [seasonID])
        return result.rows
    }
}

// FIXTURE PERSIST SERVICE - Handles complex mutations
export class FixturePersistService {
  constructor(private postgresAdapter: PostgresAdapter) {}

  // QUERY TYPE: Complex transactional mutations with multiple entity creation
  async persist(
    roundsParams: { [gradeID: string]: any[] },
    competitionType: string,
    gradeAttributes: any,
  ): Promise<{ gradeIDs: string[]; teamIDs: string[]; gameIDs: string[] }> {
    const gradeIDs = Object.keys(roundsParams)

    // TRANSACTION: Ensures data integrity across multiple operations
    const client = await this.postgresAdapter.getClient()

    try {
      await client.query('BEGIN')

      const allGameIDs: string[] = []
      const allTeamIDs: string[] = []

      // Process each grade
      for (const gradeID of gradeIDs) {
        const roundParams = roundsParams[gradeID]

        // Create/update rounds for this grade
        for (const roundParam of roundParams) {
          const { gameIDs, teamIDs } = await this.persistRound(client, gradeID, roundParam)
          allGameIDs.push(...gameIDs)
          allTeamIDs.push(...teamIDs)
        }

        // Update grade attributes
        await this.updateGradeAttributes(client, gradeID, gradeAttributes[gradeID])
      }

      await client.query('COMMIT')

      return {
        gradeIDs,
        teamIDs: [...new Set(allTeamIDs)], // Deduplicate
        gameIDs: allGameIDs,
      }
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  private async persistRound(
    client: any,
    gradeID: string,
    roundParam: any,
  ): Promise<{ gameIDs: string[]; teamIDs: string[] }> {
    // Create round if not exists (UPSERT)
    const createRoundQuery = `
      INSERT INTO rounds (grade_id, sequence_no, provisional_date, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (grade_id, sequence_no) 
      DO UPDATE SET 
        provisional_date = EXCLUDED.provisional_date,
        updated_at = NOW()
      RETURNING id as round_id
    `

    const roundResult = await client.query(createRoundQuery, [
      gradeID,
      roundParam.round.sequenceNo,
      roundParam.round.provisionalDate,
    ])

    const roundID = roundResult.rows[0].round_id
    const gameIDs: string[] = []
    const teamIDs: string[] = []

    // Create games for this round
    for (const gameData of roundParam.games) {
      const gameQuery = `
        INSERT INTO games (
          id, round_id, home_team_id, away_team_id, 
          date, provisional_dates, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING id as game_id
      `

      const gameResult = await client.query(gameQuery, [
        gameData.id,
        roundID,
        gameData.homeTeamID,
        gameData.awayTeamID,
        gameData.date,
        JSON.stringify(gameData.provisionalDates || []),
      ])

      gameIDs.push(gameResult.rows[0].game_id)
      teamIDs.push(gameData.homeTeamID, gameData.awayTeamID)
    }

    return { gameIDs, teamIDs }
  }

  private async updateGradeAttributes(client: any, gradeID: string, attributes: any): Promise<void> {
    const query = `
      UPDATE grades 
      SET no_of_rounds = $2,
          start_date = $3,
          updated_at = NOW()
      WHERE id = $1
    `

    await client.query(query, [
      gradeID,
      attributes.noOfRounds,
      attributes.startDate,
    ])
  }
}

// S3 ADAPTER - File operations
export class S3Adapter {
  async getObject(bucket: string, key: string): Promise<Buffer> {
    // Simulate S3 file fetch
    return Buffer.from('excel-file-content')
  }

  async copy(sourceBucket: string, destBucket: string, key: string): Promise<void> {
    // Simulate S3 copy operation
    console.log(`Copying ${key} from ${sourceBucket} to ${destBucket}`)
  }
}

// POSTGRES ADAPTER - Database connection abstraction
class PostgresAdapter {
  async query(sql: string, params: any[]): Promise<any> {
    // Simulate Postgres query execution
    console.log(`SQL: ${sql}`)
    console.log(`PARAMS:`, params)

    // Return mock result structure
    return {
      rows: [],
    }
  }

  async getClient(): Promise<any> {
    return {
      query: async (sql: string, params?: any[]) => ({ rows: [{ id: 'mock-id' }] }),
      release: () => {},
    }
  }
}
