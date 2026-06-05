import type { ScreenplayData, ContentElement } from '../../types';

function ContentBlock({ elem }: { elem: ContentElement }) {
  switch (elem.type) {
    case 'action':
      return <p className="text-gray-800 dark:text-gray-200 leading-relaxed mb-3">{elem.text}</p>;

    case 'dialogue':
      return (
        <div className="mb-3">
          <p className="text-center font-semibold tracking-wide uppercase text-sm text-gray-700 dark:text-gray-300 mt-4 mb-1">
            {elem.character_name || 'UNKNOWN'}
          </p>
          {elem.delivery && (
            <p className="text-center text-xs text-gray-400 dark:text-gray-500 italic mb-1">
              ({elem.delivery})
            </p>
          )}
          <p className="text-center max-w-md mx-auto text-gray-900 dark:text-gray-100 leading-relaxed px-8">
            {elem.text}
          </p>
        </div>
      );

    case 'parenthetical':
      return (
        <p className="text-center text-xs text-gray-400 dark:text-gray-500 italic my-1">
          ({elem.text})
        </p>
      );

    case 'transition':
      return (
        <p className="text-right text-sm font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-400 mt-6 mb-4 pt-2 border-t border-gray-200 dark:border-gray-700">
          {elem.text}
        </p>
      );

    case 'note':
      return (
        <div
          className={`my-3 px-4 py-2.5 rounded-lg border text-sm ${
            elem.severity === 'warning'
              ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'
              : elem.severity === 'suggestion'
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-300'
                : 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
          }`}
        >
          <span className="text-xs font-bold uppercase tracking-wide mr-2">
            [{elem.severity || 'info'}]
          </span>
          {elem.text}
        </div>
      );

    default:
      return <p className="mb-2">{elem.text}</p>;
  }
}

export default function ScreenplayPreview({ data }: { data: ScreenplayData }) {
  const { meta, characters, acts } = data;

  return (
    <div className="space-y-8">
      {/* Meta Header */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-lg">
            M
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              {(meta.title as string) || '未命名剧本'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">剧本元信息</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '场景数', value: meta.total_scenes as number, icon: 'S' },
            { label: '幕数', value: meta.total_acts as number, icon: 'A' },
            { label: '角色数', value: characters.length, icon: 'C' },
            { label: '语言', value: meta.language as string, icon: 'L' },
          ].map((item) => (
            <div key={item.label} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-center">
              <div className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
                {item.label}
              </div>
              <div className="text-lg font-bold text-gray-900 dark:text-white">{item.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Characters */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">角色列表</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500">
            {characters.length}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {characters.map((c) => {
            const roleStyle =
              c.role === 'protagonist'
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                : c.role === 'antagonist'
                  ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                  : c.role === 'supporting'
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                    : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800';

            const roleBadge =
              c.role === 'protagonist'
                ? 'bg-amber-100 text-amber-800'
                : c.role === 'antagonist'
                  ? 'bg-red-100 text-red-800'
                  : c.role === 'supporting'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-600';

            return (
              <div key={c.id} className={`rounded-xl border p-4 transition-colors ${roleStyle}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-gray-900 dark:text-white">{c.name}</span>
                  {c.gender && (
                    <span className="text-xs text-gray-400">
                      {c.gender === 'male' ? '♂' : c.gender === 'female' ? '♀' : c.gender}
                    </span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${roleBadge}`}>
                  {c.role === 'protagonist'
                    ? '主角'
                    : c.role === 'antagonist'
                      ? '反派'
                      : c.role === 'supporting'
                        ? '配角'
                        : '次要'}
                </span>
                {c.description && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">{c.description}</p>
                )}
                {c.traits.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {c.traits.slice(0, 5).map((t) => (
                      <span key={t} className="text-xs bg-white/60 dark:bg-black/20 px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-400">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Acts & Scenes */}
      <section className="space-y-8">
        {acts.map((act) => (
          <div key={act.act_number}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400 text-sm font-bold">
                {act.act_number}
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {act.title || `第${act.act_number}幕`}
              </h3>
              <span className="text-xs text-gray-400">{act.scenes.length} 场</span>
            </div>

            <div className="space-y-4">
              {act.scenes.map((scene) => (
                <div
                  key={scene.scene_number}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm"
                >
                  {/* Scene header */}
                  <div className="bg-gray-50 dark:bg-gray-800/50 px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-start gap-3">
                    <span className="shrink-0 w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400 mt-0.5">
                      {scene.scene_number}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-gray-900 dark:text-white uppercase tracking-wide text-sm">
                        {scene.scene_heading}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {scene.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {scene.time_of_day}
                        </span>
                        {scene.characters_present && scene.characters_present.length > 0 && (
                          <span className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {scene.characters_present.length} 人
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {scene.summary && (
                    <div className="px-5 py-2 bg-blue-50/50 dark:bg-blue-900/10 border-b border-blue-100 dark:border-blue-900/20">
                      <p className="text-sm text-blue-700 dark:text-blue-300 italic leading-relaxed">
                        {scene.summary}
                      </p>
                    </div>
                  )}

                  {/* Scene content */}
                  <div className="px-6 md:px-10 py-5 font-[Georgia,'Noto Serif SC',serif] text-[15px] leading-[1.8] max-w-3xl">
                    {scene.content.map((elem, i) => (
                      <ContentBlock key={i} elem={elem} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
