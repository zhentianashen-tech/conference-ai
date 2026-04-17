'use strict';

/**
 * Web Search Tool
 *
 * Provides web search capabilities using DuckDuckGo (no API key required)
 * or SerpAPI (for Google search with API key)
 */

const { search: ddgSearch } = require('duck-duck-scrape');

class SearchTool {
  constructor() {
    this.serpApiKey = process.env.SERPAPI_KEY;
    this.useDdg = !this.serpApiKey || process.env.DDG_SEARCH_ENABLED === 'true';
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Perform a web search
   * @param {string} query - Search query
   * @param {number} limit - Number of results (default 5)
   * @returns {Promise<Array>} - Search results
   */
  async search(query, limit = 5) {
    const cacheKey = `${query}_${limit}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached;

    try {
      let results;
      if (this.useDdg) {
        results = await this._searchDuckDuckGo(query, limit);
      } else {
        results = await this._searchSerpApi(query, limit);
      }
      
      this._setCached(cacheKey, results);
      return results;
    } catch (err) {
      console.error('[Search] Error:', err.message);
      return [{ title: 'Error', snippet: `Search failed: ${err.message}` }];
    }
  }

  /**
   * Search using DuckDuckGo (no API key required)
   */
  async _searchDuckDuckGo(query, limit) {
    const results = await ddgSearch(query, {
      safeSearch: 0,
      locale: 'en',
    });

    if (!results || !results.results) {
      return [];
    }

    return results.results.slice(0, limit).map(r => ({
      title: r.title || '',
      snippet: r.description || '',
      url: r.url || '',
    }));
  }

  /**
   * Search using SerpAPI (Google search, requires API key)
   */
  async _searchSerpApi(query, limit) {
    const { getJson } = require('serpapi');
    
    const response = await getJson({
      engine: 'google',
      q: query,
      api_key: this.serpApiKey,
      num: limit,
    });

    if (!response.organic_results) {
      return [];
    }

    return response.organic_results.map(r => ({
      title: r.title || '',
      snippet: r.snippet || '',
      url: r.link || '',
    }));
  }

  /**
   * Quick fact lookup - gets first result snippet
   */
  async quickLookup(query) {
    const results = await this.search(query, 1);
    if (results.length === 0) return null;
    return {
      answer: results[0].snippet,
      source: results[0].url,
    };
  }

  /**
   * Search for entity (person, company, etc.)
   */
  async searchEntity(entity, type = 'general') {
    let query = entity;
    if (type === 'person') query = `${entity} biography`;
    if (type === 'company') query = `${entity} company profile`;
    if (type === 'technology') query = `${entity} technology overview`;
    
    return this.search(query, 3);
  }

  _getCached(key) {
    const entry = this.cache.get(key);
    if (entry && Date.now() - entry.time < this.cacheTimeout) {
      return entry.data;
    }
    this.cache.delete(key);
    return null;
  }

  _setCached(key, data) {
    this.cache.set(key, { data, time: Date.now() });
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = { SearchTool };
