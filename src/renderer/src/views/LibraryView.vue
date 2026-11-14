<script setup lang="ts">
import type { Track } from '../../../shared/types'
import { player, playerState } from '../core/player'
import { useLibraryStore } from '../stores/library'

const library = useLibraryStore()

function play(track: Track): void {
  void player.play(track)
}

function editCount(track: Track): void {
  const val = prompt('修改播放次数', String(track.playCount))
  if (val === null) return
  const n = parseInt(val, 10)
  if (!Number.isNaN(n) && n >= 0) void library.setPlayCount(track.id, n)
}
</script>

<template>
  <div class="view">
    <div class="toolbar">
      <h2>音乐库</h2>
      <button :disabled="library.loading" @click="library.importFiles()">
        {{ library.loading ? '导入中…' : '导入音频文件' }}
      </button>
    </div>

    <table v-if="library.tracks.length">
      <thead>
        <tr>
          <th>标题</th>
          <th>播放次数</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="t in library.tracks"
          :key="t.id"
          :class="{ playing: playerState.current?.id === t.id }"
        >
          <td>{{ t.title }}</td>
          <td>{{ t.playCount }}</td>
          <td>
            <button class="small" @click="play(t)">播放</button>
            <button class="small ghost" @click="editCount(t)">改次数</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">暂无歌曲，点击右上角「导入音频文件」开始。</p>
  </div>
</template>
