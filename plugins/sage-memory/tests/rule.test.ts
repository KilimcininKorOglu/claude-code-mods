import { describe, expect, test, tier } from 'claude-code/testing'
import { ruleVerdictOf } from '../hooks/rule'

tier('user')

const IDS = ['01M7FBWYY7DMSP440A5BYC1Z2H', '01M7FBQZWMDSFYC1H5YMNV3DT4']

// Each reply below is one the job model (haiku) gave to the rule question.
describe('the rule question verdict', () => {
  test('SAME names the stored memory, also wrapped in markdown', () => {
    expect(ruleVerdictOf(`SAME ${IDS[0]} `, IDS)).toEqual({ kind: 'same', id: IDS[0] })
    expect(ruleVerdictOf(`**SAME ${IDS[1]}**`, IDS)).toEqual({ kind: 'same', id: IDS[1] })
  })

  test('ADD carries the joined text whole, and NEWPART the new part', () => {
    const joined = 'UI design uses flat solid colors only, never gradients or drop shadows, in every project.'
    expect(ruleVerdictOf(`ADD ${IDS[0]}: ${joined}`, IDS)).toEqual({ kind: 'add', id: IDS[0], text: joined })
    expect(ruleVerdictOf('NEWPART: Never copy or read his other stores without asking first.', IDS)).toEqual({ kind: 'newpart', text: 'Never copy or read his other stores without asking first.' })
  })

  test('NEW, also with the reason the model added', () => {
    expect(ruleVerdictOf('NEW', IDS)).toEqual({ kind: 'new' })
    expect(ruleVerdictOf('NEW: A is about a subject no stored memory covers.', IDS)).toEqual({ kind: 'new' })
  })

  test('a reply that names a memory it was not asked about, or no verdict, is no verdict', () => {
    expect(ruleVerdictOf('SAME 01NOTASKED000000000000000', IDS)).toBe(undefined)
    expect(ruleVerdictOf(`I think SAME ${IDS[0]}`, IDS)).toBe(undefined)
    expect(ruleVerdictOf(`ADD ${IDS[0]}:   `, IDS)).toBe(undefined)
    expect(ruleVerdictOf('', IDS)).toBe(undefined)
  })
})
