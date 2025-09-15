import { FixtureRepositories, S3Adapter } from './repository'
import { 
  FixtureUploadCommand, 
  BulkFixtureUpload, 
  ResultMap, 
  RoundParam,
  ValidationError,
  FixtureRow,
  ValidationContext
} from './types'

/**
 * FIXTURE UPLOAD HANDLER - INTERVIEW VERSION
 *
 * This captures the key complexity patterns and database operations from the real implementation:
 * - Complexity scales with number of grades, rounds, and teams
 * - S3 operations for file validation and storage
 * - Multiple repository calls with different query patterns
 * - Validation logic and error handling
 * - Event generation for downstream services
 */

// MAIN HANDLER - Orchestrates the entire fixture upload process
export class FixtureUploadHandler {
  constructor(
    private s3Adapter: S3Adapter,
    private repositories: FixtureRepositories,
  ) {}

  // Each grade triggers: validation, persistence, event generation
  async handle(command: FixtureUploadCommand): Promise<{ result: BulkFixtureUpload; events: any[] }> {
    const events: any[] = []

    try {
      // STEP 1: S3 file validation
      const { fileBuffer, validationErrors } = await this.validateS3File(command)

      if (validationErrors?.length) {
        return { result: { errors: validationErrors, fixture: null }, events: [] }
      }

      // STEP 2: Process fixture upload
      const uploadResult = await this.processFixtureUpload(fileBuffer!, command.seasonID)

      // STEP 3: Generate events for downstream systems
      events.push(...this.generateEvents(uploadResult))

      return {
        result: { errors: null, fixture: null },
        events,
      }
    } catch (error) {
      throw new Error('Fixture upload failed')
    }
  }

  // =============================================================================
  // VALIDATION METHODS - File format and business rule validation
  // =============================================================================

  // Validates Excel file format and business rules
  private async validateS3File(command: { seasonID: string; objectKey: string }) {
    try {
      // STEP 1: S3 file retrieval
      const fileBuffer = await this.s3Adapter.getObject('upload-bucket', command.objectKey)

      // STEP 2: File format validation
      const parseResult = await this.parseAndValidateFile(fileBuffer)
      if (parseResult.formatErrors.length > 0) {
        return {
          fileBuffer: null,
          validationErrors: parseResult.formatErrors.map(e => e.message),
          objectKey: command.objectKey,
        }
      }

      // STEP 3: Business rule validation
      const businessValidationErrors = await this.validateBusinessRules(parseResult.fixtureRows, command.seasonID)

      const allErrors = [...parseResult.formatErrors, ...businessValidationErrors]

      return {
        fileBuffer,
        validationErrors: allErrors.length > 0 ? allErrors.map(e => e.message) : null,
        objectKey: command.objectKey,
      }
    } catch (error) {
      return {
        fileBuffer: null,
        validationErrors: ['Failed to access or process uploaded file'],
        objectKey: command.objectKey,
      }
    }
  }

  // FILE FORMAT VALIDATION
  private async parseAndValidateFile(
    fileBuffer: Buffer,
  ): Promise<{
    fixtureRows: FixtureRow[]
    formatErrors: ValidationError[]
  }> {
    const formatErrors: ValidationError[] = []
    const fixtureRows: FixtureRow[] = []

    try {
      // Simulate Excel parsing - real implementation uses xlsx library
      const mockExcelData = this.simulateExcelParsing(fileBuffer)

      // VALIDATION LOOP - This is where O(n) complexity starts
      mockExcelData.forEach((row, index) => {
        const rowNumber = index + 2 // Excel rows start at 2 (header at 1)

        // Required field validation
        if (!row.gradeCode?.trim()) {
          formatErrors.push({
            type: 'FILE_FORMAT',
            message: `Row ${rowNumber}: Grade Code is required`,
            row: rowNumber,
            column: 'Grade Code',
          })
        }

        if (!row.homeTeam?.trim()) {
          formatErrors.push({
            type: 'FILE_FORMAT',
            message: `Row ${rowNumber}: Home Team is required`,
            row: rowNumber,
            column: 'Home Team',
          })
        }

        if (!row.awayTeam?.trim()) {
          formatErrors.push({
            type: 'FILE_FORMAT',
            message: `Row ${rowNumber}: Away Team is required`,
            row: rowNumber,
            column: 'Away Team',
          })
        }

        // Date format validation
        if (!this.isValidDate(row.date)) {
          formatErrors.push({
            type: 'FILE_FORMAT',
            message: `Row ${rowNumber}: Invalid date format. Use DD/MM/YYYY`,
            row: rowNumber,
            column: 'Date',
          })
        }

        // Round number validation
        if (!row.round || row.round < 1) {
          formatErrors.push({
            type: 'FILE_FORMAT',
            message: `Row ${rowNumber}: Round must be a positive number`,
            row: rowNumber,
            column: 'Round',
          })
        }

        // Same team validation
        if (row.homeTeam === row.awayTeam) {
          formatErrors.push({
            type: 'FILE_FORMAT',
            message: `Row ${rowNumber}: Home team and away team cannot be the same`,
            row: rowNumber,
          })
        }

        // If row passed basic validation, add to results
        if (formatErrors.filter(e => e.row === rowNumber).length === 0) {
          fixtureRows.push({
            gradeCode: row.gradeCode.trim(),
            homeTeam: row.homeTeam.trim(),
            awayTeam: row.awayTeam.trim(),
            date: row.date,
            round: parseInt(row.round),
            gameType: row.gameType?.trim(),
          })
        }
      })

      return { fixtureRows, formatErrors }
    } catch (error) {
      return {
        fixtureRows: [],
        formatErrors: [
          {
            type: 'FILE_FORMAT',
            message: 'Unable to parse Excel file. Please ensure file is in correct format.',
          },
        ],
      }
    }
  }

  // BUSINESS RULE VALIDATION
  private async validateBusinessRules(fixtureRows: FixtureRow[], seasonID: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = []

    // STEP 1: Load validation context
    const context = await this.loadValidationContext(seasonID, fixtureRows)

    // STEP 2: Validate each fixture row - POTENTIAL O(n²) ISSUE HERE!
    for (const row of fixtureRows) {
      errors.push(...(await this.validateFixtureRow(row, context)))
    }

    // STEP 3: Cross-row validations for duplicates
    errors.push(...this.validateCrossRowRules(fixtureRows))

    return errors
  }

  // CONTEXT LOADING - Database queries
  private async loadValidationContext(seasonID: string, fixtureRows: FixtureRow[]): Promise<ValidationContext> {
    const uniqueGradeCodes = [...new Set(fixtureRows.map(r => r.gradeCode))]

    // Parallel database queries for performance
    const [grades, teams, existingFixtures] = await Promise.all([
      this.repositories.gradeRepo.findBySeasonIDAndCodes(seasonID, uniqueGradeCodes),
      this.repositories.teamRepo.findBySeasonID(seasonID),
      this.repositories.gradeRepo.hasFixturesByCode(uniqueGradeCodes),
    ])

    return {
      seasonID,
      grades,
      teams,
      existingFixtures,
    }
  }

  // SINGLE ROW VALIDATION - Contains O(n) lookups that could be optimized
  private async validateFixtureRow(row: FixtureRow, context: ValidationContext): Promise<ValidationError[]> {
    const errors: ValidationError[] = []

    // Grade existence validation - O(n) lookup in grades array
    const grade = context.grades.find(g => g.code === row.gradeCode)
    if (!grade) {
      errors.push({
        type: 'BUSINESS_RULE',
        message: `Grade '${row.gradeCode}' does not exist in this season`,
        gradeID: row.gradeCode,
      })
      return errors // Can't validate further without valid grade
    }

    // Team existence validation - O(n) lookups in teams array
    const gradeTeams = context.teams.filter(t => t.gradeID === grade.id)
    const homeTeam = gradeTeams.find(t => t.name === row.homeTeam)
    const awayTeam = gradeTeams.find(t => t.name === row.awayTeam)

    if (!homeTeam) {
      errors.push({
        type: 'BUSINESS_RULE',
        message: `Home team '${row.homeTeam}' is not registered in grade '${row.gradeCode}'`,
        gradeID: grade.id,
      })
    }

    if (!awayTeam) {
      errors.push({
        type: 'BUSINESS_RULE',
        message: `Away team '${row.awayTeam}' is not registered in grade '${row.gradeCode}'`,
        gradeID: grade.id,
      })
    }

    // Round sequence validation
    if (row.round > grade.noOfRounds) {
      errors.push({
        type: 'BUSINESS_RULE',
        message: `Round ${row.round} exceeds maximum rounds (${grade.noOfRounds}) for grade '${row.gradeCode}'`,
        gradeID: grade.id,
      })
    }

    // Date validation (business rules)
    const fixtureDate = new Date(this.parseDate(row.date))
    const today = new Date()

    if (fixtureDate < today && !context.existingFixtures[grade.id]) {
      errors.push({
        type: 'BUSINESS_RULE',
        message: `Cannot schedule games in the past for grade '${row.gradeCode}'. Date: ${row.date}`,
        gradeID: grade.id,
      })
    }

    return errors
  }

  // CROSS-ROW VALIDATIONS
  private validateCrossRowRules(fixtureRows: FixtureRow[]): ValidationError[] {
    const errors: ValidationError[] = []
    const gameSignatures = new Set<string>()
    const teamRoundTracker = new Map<string, Set<number>>()

    // Check for duplicate games and team double-booking
    fixtureRows.forEach(row => {
      const gameSignature = `${row.gradeCode}-${row.homeTeam}-${row.awayTeam}-${row.round}`

      // Duplicate game detection
      if (gameSignatures.has(gameSignature)) {
        errors.push({
          type: 'DATA_INTEGRITY',
          message: `Duplicate game: ${row.homeTeam} vs ${row.awayTeam} in round ${row.round} of grade ${row.gradeCode}`,
        })
      }
      gameSignatures.add(gameSignature)

      // Team double-booking detection
      const homeKey = `${row.gradeCode}-${row.homeTeam}`
      const awayKey = `${row.gradeCode}-${row.awayTeam}`

      if (!teamRoundTracker.has(homeKey)) teamRoundTracker.set(homeKey, new Set())
      if (!teamRoundTracker.has(awayKey)) teamRoundTracker.set(awayKey, new Set())

      if (teamRoundTracker.get(homeKey)!.has(row.round)) {
        errors.push({
          type: 'DATA_INTEGRITY',
          message: `Team '${row.homeTeam}' is scheduled for multiple games in round ${row.round} of grade ${row.gradeCode}`,
        })
      }

      if (teamRoundTracker.get(awayKey)!.has(row.round)) {
        errors.push({
          type: 'DATA_INTEGRITY',
          message: `Team '${row.awayTeam}' is scheduled for multiple games in round ${row.round} of grade ${row.gradeCode}`,
        })
      }

      teamRoundTracker.get(homeKey)!.add(row.round)
      teamRoundTracker.get(awayKey)!.add(row.round)
    })

    return errors
  }

  // =============================================================================
  // PROCESSING METHODS - Core business logic
  // =============================================================================

  // CORE PROCESSING LOGIC
  private async processFixtureUpload(fileBuffer: Buffer, seasonID: string) {
    // Parse Excel file
    const roundsParams = await this.parseFixtureFile(fileBuffer, seasonID)
    const gradeIDs = Object.keys(roundsParams)

    // PARALLEL DATABASE QUERIES - Run concurrently for performance
    const [hasFixtureByGradeIDs, gamesByGradeIDs, competition] = await Promise.all([
      this.repositories.gradeRepo.hasFixtures(gradeIDs), // CHECK existence
      this.repositories.gameRepo.findByGradeIDs(gradeIDs), // FETCH existing games
      this.repositories.competitionRepo.findBySeasonID(seasonID), // FETCH competition
    ])

    // Calculate grade attributes
    const gradeAttributes = await this.calculateGradeAttributes(roundsParams)

    // PERSISTENCE - Most expensive operation
    const persistResult = await this.repositories.persistService.persist(
      roundsParams,
      competition?.type || 'DOMESTIC',
      gradeAttributes,
    )

    return {
      gradeIDs: persistResult.gradeIDs,
      teamIDs: persistResult.teamIDs,
      newGameIDs: persistResult.gameIDs,
      existingGames: Object.values(gamesByGradeIDs).flat(),
      hasFixtureByGradeIDs,
    }
  }

  // File parsing
  private async parseFixtureFile(fileBuffer: Buffer, seasonID: string): Promise<{ [gradeID: string]: RoundParam[] }> {
    // Simulate Excel parsing complexity
    return {} // Simplified - real version parses Excel workbook
  }

  // Grade attribute calculation
  private async calculateGradeAttributes(roundsParams: { [gradeID: string]: RoundParam[] }) {
    const gradeIDs = Object.keys(roundsParams)
    // Fetch existing rounds to calculate totals
    const allRoundsByGrade = await this.repositories.roundRepo.findByGradeIDs(gradeIDs)

    return gradeIDs.reduce((acc, gradeID) => {
      const existingRounds = allRoundsByGrade[gradeID] || []
      const suppliedRounds = roundsParams[gradeID]
      const totalRoundsCount = existingRounds.length + suppliedRounds.length
      const firstDate = existingRounds[0]?.provisionalDate || suppliedRounds[0]?.round?.provisionalDate

      acc[gradeID] = {
        noOfRounds: totalRoundsCount,
        startDate: firstDate,
      }
      return acc
    }, {} as any)
  }

  // =============================================================================
  // EVENT GENERATION METHODS
  // =============================================================================

  // Event generation
  private generateEvents(uploadResult: any) {
    const events: any[] = []

    // Ladder recalculation events
    events.push(...uploadResult.gradeIDs.map(id => ({ type: 'CalculateLadder', gradeID: id })))

    // Game allocation events
    if (uploadResult.existingGames.length > 0) {
      events.push({ type: 'GamesAllocated', games: uploadResult.existingGames })
    }

    if (uploadResult.newGameIDs.length > 0) {
      events.push({ type: 'GamesAllocationCreated', gameIDs: uploadResult.newGameIDs })
    }

    // Team and fixture webhook events
    events.push({ type: 'TeamUpdated', teamIDs: uploadResult.teamIDs })
    events.push(...this.getFixtureWebhookEvents(uploadResult.gradeIDs, uploadResult.hasFixtureByGradeIDs))

    return events
  }

  private getFixtureWebhookEvents(gradeIDs: string[], hasFixtureByGradeIDs: ResultMap<boolean>) {
    return gradeIDs.map(gradeID => ({
      type: hasFixtureByGradeIDs[gradeID] ? 'FixtureUpdated' : 'FixtureCreated',
      gradeID,
    }))
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  private simulateExcelParsing(fileBuffer: Buffer): any[] {
    // Simulate parsing Excel file - real implementation uses xlsx library
    return [
      { gradeCode: 'A1', homeTeam: 'Lions', awayTeam: 'Tigers', date: '15/03/2024', round: '1' },
      { gradeCode: 'A1', homeTeam: 'Bears', awayTeam: 'Wolves', date: '15/03/2024', round: '1' },
    ]
  }

  private isValidDate(dateString: string): boolean {
    if (!dateString) return false
    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/
    return dateRegex.test(dateString) && !isNaN(Date.parse(this.parseDate(dateString)))
  }

  private parseDate(dateString: string): string {
    // Convert DD/MM/YYYY to MM/DD/YYYY for Date parsing
    const [day, month, year] = dateString.split('/')
    return `${month}/${day}/${year}`
  }
}
