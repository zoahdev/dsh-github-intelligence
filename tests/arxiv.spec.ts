import { describe, expect, it } from 'vitest'
import { parseArxivAtom } from '../src/arxiv.ts'

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2005.11401</id>
    <updated>2020-05-25T17:51:14Z</updated>
    <published>2020-05-22T17:51:14Z</published>
    <title>Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks</title>
    <summary>Large pre-trained language models store factual knowledge...</summary>
    <author><name>Patrick Lewis</name></author>
    <author><name>Ethan Perez</name></author>
    <link href="http://arxiv.org/abs/2005.11401v1" rel="alternate" type="text/html"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1706.03762</id>
    <updated>2017-06-19T17:51:14Z</updated>
    <published>2017-06-12T17:51:14Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on...</summary>
    <author><name>Ashish Vaswani</name></author>
    <link href="http://arxiv.org/abs/1706.03762v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`

describe('parseArxivAtom', () => {
  it('parses entries, authors, and links from an Atom feed', () => {
    const entries = parseArxivAtom(SAMPLE)
    expect(entries).toHaveLength(2)
    expect(entries[0].title).toBe('Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks')
    expect(entries[0].authors).toEqual(['Patrick Lewis', 'Ethan Perez'])
    expect(entries[0].published).toBe('2020-05-22T17:51:14Z')
    expect(entries[0].link).toBe('http://arxiv.org/abs/2005.11401v1')
    expect(entries[1].title).toBe('Attention Is All You Need')
  })

  it('decodes XML entities in titles and summaries', () => {
    const xml = `<feed><entry><title>A &amp; B &lt;test&gt;</title><summary>x &gt; y</summary><id>1</id></entry></feed>`
    const [entry] = parseArxivAtom(xml)
    expect(entry?.title).toBe('A & B <test>')
    expect(entry?.summary).toBe('x > y')
  })

  it('returns an empty array for a feed with no entries', () => {
    expect(parseArxivAtom('<feed></feed>')).toEqual([])
  })
})
