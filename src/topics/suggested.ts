'use strict';

const _ : _.LoDashStatic = require('lodash');

const db = require('../database');
const user = require('../user');
const privileges = require('../privileges');
const search = require('../search');

module.exports = function (Topics: { getSuggestedTopics: (tid: string, uid: string, start: number, stop: number, cutoff?: number) => Promise<any>; getTopicsByTids: (arg0: any, arg1: string) => any; getTopicTags: (arg0: number) => any; getTopicFields: (arg0: number, arg1: string[]) => any; getTopicField: (arg0: number, arg1: string) => any; }) {
    Topics.getSuggestedTopics = async function (tid : string, uid : string, start: number, stop: number, cutoff = 0) {
        let tids, tid_num;
        tid_num = parseInt(tid, 10);
        cutoff = cutoff === 0 ? cutoff : (cutoff * 2592000000);
        const [tagTids, searchTids] = await Promise.all([
            getTidsWithSameTags(tid_num, cutoff),
            getSearchTids(tid_num, uid, cutoff),
        ]);

        tids = _.uniq(tagTids.concat(searchTids));

        let categoryTids = [];
        if (stop !== -1 && tids.length < stop - start + 1) {
            categoryTids = await getCategoryTids(tid_num, cutoff);
        }
        tids = _.shuffle(_.uniq(tids.concat(categoryTids)));
        tids = await privileges.topics.filterTids('topics:read', tids, uid);

        let topicData = await Topics.getTopicsByTids(tids, uid);
        topicData = topicData.filter((topic: { tid: string; }) => topic && topic.tid !== tid);
        topicData = await user.blocks.filter(uid, topicData);
        topicData = topicData.slice(start, stop !== -1 ? stop + 1 : undefined)
            .sort((t1: { timestamp: number; }, t2: { timestamp: number; }) => t2.timestamp - t1.timestamp);
        return topicData;
    };

    async function getTidsWithSameTags(tid: number, cutoff: number) {
        const tags = await Topics.getTopicTags(tid);
        let tids = cutoff === 0 ?
            await db.getSortedSetRevRange(tags.map((tag: any) => `tag:${tag}:topics`), 0, -1) :
            await db.getSortedSetRevRangeByScore(tags.map((tag: any) => `tag:${tag}:topics`), 0, -1, '+inf', Date.now() - cutoff);
        tids = tids.filter((_tid: number) => _tid !== tid); // remove self
        return _.shuffle(_.uniq(tids)).slice(0, 10).map(Number);
    }

    async function getSearchTids(tid: number, uid: string, cutoff: number) {
        const topicData = await Topics.getTopicFields(tid, ['title', 'cid']);
        const data = await search.search({
            query: topicData.title,
            searchIn: 'titles',
            matchWords: 'any',
            categories: [topicData.cid],
            uid: uid,
            returnIds: true,
            timeRange: cutoff !== 0 ? cutoff / 1000 : 0,
            timeFilter: 'newer',
        });
        data.tids = data.tids.filter((_tid: number) => _tid !== tid); // remove self
        return _.shuffle(data.tids).slice(0, 10).map(Number);
    }

    async function getCategoryTids(tid: number, cutoff: number) {
        const cid = await Topics.getTopicField(tid, 'cid');
        const tids = cutoff === 0 ?
            await db.getSortedSetRevRange(`cid:${cid}:tids:lastposttime`, 0, 9) :
            await db.getSortedSetRevRangeByScore(`cid:${cid}:tids:lastposttime`, 0, 9, '+inf', Date.now() - cutoff);
        return _.shuffle(tids.map(Number).filter((_tid: number) => _tid !== tid));
    }
};
