
import * as fs from 'fs'
import * as path from 'path'
import * as Lunr from 'lunr'
import * as Loki from 'lokijs'

import { firstBy } from 'thenby'
import { Logger } from './Logger'

// 1) don't forget to update docs with wildcard support, field:search, title:foo* bar
// A B means A or B
// +foo +bar means 

// 2) multi-word tags :(
// 3) f#, c++

export default class Fastr {

  lunr: Lunr.Index
  videos: any
  tags: Set<string>
  speakers: any
  channels: any

  constructor(docsHome: String) {

    let loki = new Loki('mem.db')
    let videos = loki.addCollection('videos', { 
      unique: ['objectID'],
      indices: ['satisfaction']
    })

    let speakers = loki.addCollection('speakers', { 
      unique: ['twitter']
    })

    let channels = loki.addCollection('channels', { 
      unique: ['id']
    })    

    let tags = new Set<string>()
    this.tags = tags
    this.channels = channels
    this.speakers = speakers
    this.videos = videos

    let docLoader = () => {      
      let walkSync = (dir, filelist = []) => {
          fs.readdirSync(dir).forEach(file => {
            filelist = fs.statSync(path.join(dir, file)).isDirectory()
              ? walkSync(path.join(dir, file), filelist)
              : filelist.concat(path.join(dir, file))
          })
          return filelist
      }

      Logger.info(`Experimental Fastr storage mode is turned on.`)
      Logger.info(`Loading .json docs from dir ${docsHome}`)

      let docs = walkSync(docsHome)
        .filter(f => f.endsWith('.json'))
        .map(f => fs.readFileSync(f).toJSON())

      Logger.info(`${docs.length} docs loaded`)

      return docs

    }     

    let docsLoaded = docLoader() 

    this.lunr = Lunr(function () {

      this.ref('objectID')
      this.field('title')
      this.field('speaker', { extractor: (doc) => doc.speaker ? doc.speaker.name : doc.speaker })
      this.field('tags')
      this.field('channelTitle')

      docsLoaded.forEach((video: any) => {
        this.add(video)
        if (video.speaker && !speakers.by("twitter", video.speaker.twitter)) {
          speakers.insert(video.speaker)  
        }

        if (!channels.by("id", video.channelId)) {
          channels.insert({
            id: video.channelId,
            title: video.channelTitle
          } as any)  
        }

        if (video.tags) {
          video.tags.forEach(tag => tags.add(tag))
        }
        videos.insert(video)
      })
    })    
    
  }

  searchChannels() {
    return this.channels.chain().simplesort('title').data()
  }

  searchTags() {
    return Array.from(this.tags).sort()
  }

  searchSpeakers() {
    return this.speakers.chain().simplesort('name').data()
  }

  search(query: string, refinement = {}, sortProperty: string, page: number, maxHitsPerPage: number, maxHitsPerQuery: number) {
    // if there is fuzzy query string provided, then search in Loki
    if (!query) {
      let descending = true
      return this.videos
        .chain()
        .find(refinement)
        .simplesort(sortProperty, descending)
        .offset(page * maxHitsPerPage)
        .limit(maxHitsPerQuery)
        .data()
    }

    // if fuzzy query string provided, then search in Lunr AND Loki
    if (query) {
      let queryHits = this.searchInLunr(query, sortProperty, page, maxHitsPerPage, maxHitsPerQuery)
      return queryHits
    }    

  }

  private searchInLunr(query: string, sortProperty: string, page: number, maxHitsPerPage: number, maxHitsPerQuery: number) {
    let hits = this.lunr.search(query)
    let hitsTotal = hits.length
    let sortPropertyDesc = `-${sortProperty}`
    return hits
      .map(hit => this.videos.by("objectID", hit.ref))
      .sort(firstBy(sortProperty, -1))
      .slice(page * maxHitsPerPage, page * maxHitsPerPage + maxHitsPerQuery)
  }

}