import { ValidationRepositories, S3Adapter } from './interview-repository-layer'

/**
 * SIMPLIFIED VALIDATION SERVICE - INTERVIEW VERSION
 *
 * This captures the validation complexity patterns from the real implementation:
 * - File format validation (Excel parsing)
 * - Business rule validation with database lookups
 * - Multi-level validation hierarchy (file -> template -> business rules)
 * - Big O complexity analysis for each validation type
 * - Error aggregation and user-friendly messaging
 */

interface ValidationError {
  type: 'FILE_FORMAT' | 'BUSINESS_RULE' | 'DATA_INTEGRITY'
  message: string
  row?: number
  column?: string
  gradeID?: string
}

interface FixtureRow {
  gradeCode: string
  homeTeam: string
  awayTeam: string
  date: string
  round: number
  gameType?: string
}

interface Grade {
  id: string
  code: string
  seasonID: string
  noOfRounds: number
}

interface Team {
  id: string
  name: string
  gradeID: string
}

interface ValidationContext {
  seasonID: string
  grades: Grade[]
  teams: Team[]
  existingFixtures: { [gradeID: string]: boolean }
}

// MAIN VALIDATION SERVICE - Orchestrates all validation types
export class FixtureValidationService {
  constructor(private repositories: ValidationRepositories) {}

  // Validates Excel file format and business rules
  async validateS3File(command: { seasonID: string; objectKey: string }, s3Adapter: S3Adapter) {
    try {
      // STEP 1: S3 file retrieval
      const fileBuffer = await s3Adapter.getObject('upload-bucket', command.objectKey)

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

      // VALIDATION LOOP
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

    // STEP 2: Validate each fixture row
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
      this.repositories.gradeRepo.hasFixtures(uniqueGradeCodes),
    ])

    return {
      seasonID,
      grades,
      teams,
      existingFixtures,
    }
  }

  // SINGLE ROW VALIDATION
  private async validateFixtureRow(row: FixtureRow, context: ValidationContext): Promise<ValidationError[]> {
    const errors: ValidationError[] = []

    // Grade existence validation
    const grade = context.grades.find(g => g.code === row.gradeCode)
    if (!grade) {
      errors.push({
        type: 'BUSINESS_RULE',
        message: `Grade '${row.gradeCode}' does not exist in this season`,
        gradeID: row.gradeCode,
      })
      return errors // Can't validate further without valid grade
    }

    // Team existence validation
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

  // HELPER METHODS
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
