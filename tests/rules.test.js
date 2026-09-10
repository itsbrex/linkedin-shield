/**
 * Declarative net request rules tests — validate rules.json structure
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rules = JSON.parse(readFileSync(resolve(__dirname, '../rules.json'), 'utf8'));

describe('Rules — Structure Validation', () => {
  it('has rules defined', () => {
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('all rules have unique IDs', () => {
    const ids = rules.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all rules have required fields', () => {
    for (const rule of rules) {
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('action');
      expect(rule).toHaveProperty('condition');
      expect(typeof rule.id).toBe('number');
    }
  });

  it('only blocks requests or removes the observed APFC header', () => {
    for (const rule of rules) {
      expect(['block', 'modifyHeaders']).toContain(rule.action.type);
      if (rule.action.type === 'modifyHeaders') {
        expect(rule.action.requestHeaders).toEqual([{ header: 'X-Li-Apfc-Data', operation: 'remove' }]);
        expect(rule.condition.requestDomains).toEqual(['linkedin.com']);
        expect(rule.condition.initiatorDomains).toEqual(['linkedin.com']);
      }
    }
  });

  it('rules target LinkedIn-related domains', () => {
    const targetDomains = rules.flatMap((r) => r.condition.initiatorDomains || r.condition.requestDomains || []);
    const hasLinkedIn = targetDomains.some((d) => d.includes('linkedin'));
    expect(hasLinkedIn).toBe(true);
  });
});

describe('Rules — Captured APFC paths', () => {
  const capturedRules = rules.filter((rule) => [8, 9, 10, 11].includes(rule.id));

  it.each([
    'https://www.linkedin.com/platform-telemetry/li/apfcDf',
    'https://www.linkedin.com/apfc/collect?session=private',
    'https://www.linkedin.com/li/track',
    'https://merchantpool1.linkedin.com/mdt.js?session_id=private',
  ])('matches captured endpoint %s', (url) => {
    expect(capturedRules.some((rule) => new RegExp(rule.condition.regexFilter).test(url))).toBe(true);
  });

  it.each([
    'https://example.com/apfc/collect',
    'https://linkedin.com.example.com/li/track',
    'https://www.linkedin.com/apfc/collector',
    'https://www.linkedin.com/voyager/api/me',
    'https://www.linkedin.com/checkpoint/challenge',
    'https://merchantpool1.linkedin.com/mdt.js.map',
  ])('does not block unrelated URL %s', (url) => {
    expect(capturedRules.some((rule) => new RegExp(rule.condition.regexFilter).test(url))).toBe(false);
  });

  it('scopes added blocking and HUMAN rules to LinkedIn initiators', () => {
    for (const rule of [...capturedRules, rules.find((rule) => rule.id === 3)]) {
      expect(rule.condition.initiatorDomains).toEqual(['linkedin.com']);
      expect(rule.condition.requestDomains.length).toBeGreaterThan(0);
    }
  });
});

describe('Rules — Surveillance Endpoints', () => {
  it('blocks sensorCollect endpoint', () => {
    const sensorRule = rules.find(
      (r) => r.condition.urlFilter?.includes('sensorCollect') || r.condition.regexFilter?.includes('sensorCollect'),
    );
    expect(sensorRule).toBeDefined();
  });

  it('blocks protechts.net (HUMAN Security)', () => {
    const protechtsRule = rules.find(
      (r) =>
        r.condition.urlFilter?.includes('protechts') ||
        r.condition.requestDomains?.some((d) => d.includes('protechts')),
    );
    expect(protechtsRule).toBeDefined();
  });
});

describe('Rules — Manifest Consistency', () => {
  it('manifest references rules.json', () => {
    const manifest = JSON.parse(readFileSync(resolve(__dirname, '../manifest.json'), 'utf8'));
    expect(manifest.declarative_net_request).toBeDefined();
    const ruleResources = manifest.declarative_net_request.rule_resources;
    expect(ruleResources).toBeDefined();
    const linkedinRule = ruleResources.find((r) => r.path === 'rules.json');
    expect(linkedinRule).toBeDefined();
    expect(linkedinRule.enabled).toBe(true);
  });
});
