"""Build client-present supplements from DE Public Export and decoded Packages.bin.
Offline only. Inputs are explicit, and no live database or node_modules are written.
"""
import argparse,copy,hashlib,json,pathlib,re
ap=argparse.ArgumentParser();ap.add_argument('--exports',type=pathlib.Path,required=True);ap.add_argument('--metadata',type=pathlib.Path,required=True);ap.add_argument('--server',type=pathlib.Path,required=True);ap.add_argument('--weapon-rules',type=pathlib.Path);ap.add_argument('--market-evidence',type=pathlib.Path);a=ap.parse_args()
meta=json.loads(a.metadata.read_text(encoding='utf-8'));pkg=a.server/'node_modules/warframe-public-export-plus';registry=json.loads((a.server/'static/generated/openwf-metadata/challenge-metadata.json').read_text(encoding='utf-8'))
out={'schemaVersion':1,'source':{'packagesSha256':registry['source'].get('packagesSha256'),'files':{}},'datasets':{},'dictionary':{},'rivenContracts':{}}
def load(name):
 p=a.exports/(name+'_en.json');out['source']['files'][p.name]=hashlib.sha256(p.read_bytes()).hexdigest();return json.loads(p.read_text(encoding='utf-8'),strict=False)[name]
def props(k):return meta[k]['fields']
def clean(s):return s.strip('"')
def scalar(k,f,default=None):return clean(props(k).get(f,default)) if f in props(k) else default
def entries(k,prefix):
 d={}
 for q in meta[k]['query']:
  m=re.match(re.escape(prefix)+r'\.(\d+)\.(.*)',q['Path'])
  if m:d.setdefault(int(m[1]),{})[m[2]]=clean(q['Value'])
 return [d[i] for i in sorted(d)]
def base(k,row):
 v=copy.deepcopy(row);v.pop('uniqueName',None);f=props(k)
 for src,dst in [('Icon','icon'),('LocalizeTag','name'),('LocalizeDescTag','description')]:
  if src in f:
   v[dst]=clean(f[src])
   if dst in ['name','description'] and row.get(dst):out['dictionary'][v[dst]]=row[dst]
 if k in registry['generatedItems']:v['productCategory']=registry['generatedItems'][k]['productCategory']
 for src,dst in [('PremiumPrice','platinumCost'),('RegularPrice','creditsCost')]:
  if src in f and float(f[src])>=0:v[dst]=float(f[src])
 if scalar(k,'Tradable') is not None:v['tradable']=scalar(k,'Tradable')=='1'
 return v
for name in ['ExportResources','ExportRecipes','ExportWarframes','ExportWeapons','ExportUpgrades']:
 old=json.loads((pkg/(name+'.json')).read_text(encoding='utf-8'));new={}
 for row in load(name):
  k=row['uniqueName']
  if k in old:continue
  if k not in meta:raise ValueError('No client metadata for '+k)
  v=base(k,row);f=props(k)
  if name in ['ExportWarframes','ExportWeapons']:
   v['parentName']=meta[k]['parent'];v['variantType']=scalar(k,'VariantType','VT_NORMAL') # same documented upstream default
   extra=[clean(q['Value']) for q in meta[k]['query'] if re.fullmatch(r'AdditionalItems\.\d+',q['Path'])]
   if extra:
    if any(not x.startswith('/Lotus/') for x in extra):raise ValueError('Unresolved AdditionalItems for '+k)
    v['additionalItems']=extra
   if 'LevelCap' in f:v['maxLevelCap']=int(f['LevelCap'])
  if name=='ExportWarframes':
   abilities=[]
   for ab in row['abilities']:
    ak=ab['abilityUniqueName'];af=props(ak);av={'uniqueName':ak,'name':scalar(ak,'LocalizeTag',ab['abilityName']),'description':scalar(ak,'LocalizeDescTag',ab['description']),'icon':scalar(ak,'Icon'),'energyRequiredToActivate':float(af.get('EnergyRequiredToActivate',25))}
    out['dictionary'][av['name']]=ab['abilityName'];out['dictionary'][av['description']]=ab['description'];abilities.append(av)
   v['abilities']=abilities
   special=[q['Value'] for q in meta[k]['query'] if q['Path'].startswith('SpecialSlotItem.') and q['Key']=='ItemType' and q['Value']!='""']
   if special:v['exalted']=special
  if name=='ExportWeapons':
   v['tradable']=scalar(k,'Tradable','0')=='1'
   if scalar(k,'CompatibilityTags'):v['compatibilityTags']=[q['Value'] for q in meta[k]['query'] if re.fullmatch(r'CompatibilityTags\.\d+',q['Path'])]
  if name=='ExportRecipes':
   v.pop('productCategory',None);v['ingredients']=[{'ItemType':x['ItemType'],'ItemCount':x['ItemCount']} for x in row['ingredients']]
  if name=='ExportUpgrades':
   v['compat']=scalar(k,'ItemCompatibility');v['canBeTransmutation']=scalar(k,'CanBeTransmutation','0')=='1';v['tradable']=scalar(k,'Tradable','0')=='1'
   v['levelStats']=copy.deepcopy(row.get('levelStats',[]))
  new[k]=v
 out['datasets'][name]=new
# Relics use the existing server's refinement/rarity weighting. DE supplies the
# reward identities/counts/rarities; do not invent per-item probabilities.
old_relics=json.loads((pkg/'ExportRelics.json').read_text(encoding='utf-8'));old_rewards=json.loads((pkg/'ExportRewards.json').read_text(encoding='utf-8'))
relics={};rewards={}
for row in load('ExportRelicArcane'):
 k=row['uniqueName']
 if 'relicRewards' not in row or k in old_relics:continue
 if k not in meta:raise ValueError('No relic metadata for '+k)
 words=row['name'].split();manifest=scalar(k,'RewardManifest')
 if not manifest:raise ValueError('No reward manifest for '+k)
 relics[k]={'era':words[0],'category':words[1],'icon':scalar(k,'Icon'),'codexSecret':row.get('codexSecret',False),'description':scalar(k,'LocalizeDescTag',row.get('description','')),'quality':scalar(k,'Quality','VPQ_BRONZE'),'rewardManifest':manifest}
 deck=[[{'type':r['rewardName'],'itemCount':r['itemCount'],'rarity':r['rarity']} for r in row['relicRewards']]]
 if manifest not in old_rewards:
  if manifest in rewards and rewards[manifest]!=deck:raise ValueError('Inconsistent refinement rewards: '+manifest)
  rewards[manifest]=deck
out['datasets']['ExportRelics']=relics;out['datasets']['ExportRewards']=rewards
# Quest records use the existing key/quest inventory path, including the actual
# stage keys and inbox fields. No quest completion or progression is synthesized.
old_keys=json.loads((pkg/'ExportKeys.json').read_text(encoding='utf-8'));keys={}
def key_record(k,row):
 v=base(k,row);v['parentName']=meta[k]['parent'];v['rewards']=[]
 v['mission']={q['Path'][8:]:int(q['Value']) for q in meta[k]['query'] if q['Path'] in ['Mission.minEnemyLevel','Mission.maxEnemyLevel']}
 if scalar(k,'Reward') or scalar(k,'QuestRewards'):raise ValueError('Quest reward conversion needs explicit support: '+k)
 return v
for row in load('ExportKeys'):
 k=row['uniqueName']
 if k in old_keys:continue
 v=key_record(k,row);v['replayable']=scalar(k,'CanReplay')=='1';stages=[]
 for stage in entries(k,'ChainStages'):
  sv={'itemsToGiveWhenTriggered':[value for path,value in stage.items() if re.fullmatch(r'ItemsToGiveWhenTriggered\.\d+',path)]}
  if stage.get('Key'):
   sk=stage['Key'] if stage['Key'].startswith('/') else k.rsplit('/',1)[0]+'/'+stage['Key'];sv['key']=sk
   if sk not in old_keys:keys[sk]=key_record(sk,{'uniqueName':sk})
  if stage.get('MessageToSendWhenTriggered.sub'):
   message={}
   for field in ['sub','sndr','msg','icon','transmission','ordisReactionTransmission']:
    value=stage.get('MessageToSendWhenTriggered.'+field)
    if value:message[field]=value
   for field in ['att','countedAtt','attSpecial','syndicateAttachment']:
    if any(path.startswith('MessageToSendWhenTriggered.'+field+'.') for path in stage):raise ValueError('Unconverted quest attachment: '+k)
   message['highPriority']=stage.get('MessageToSendWhenTriggered.highPriority')=='1';sv['messageToSendWhenTriggered']=message
  stages.append(sv)
 v['chainStages']=stages;keys[k]=v
out['datasets']['ExportKeys']=keys
# Record full current Riven contracts, including advanced-only flags, from client metadata.
for k,v in meta.items():
 if '/Randomized/' not in k or 'UpgradeEntries' not in v['fields']:continue
 es=entries(k,'UpgradeEntries');merges=entries(k,'MergeOptions')
 out['rivenContracts'][k]={'entries':[{ 'tag':e['Tag'],'canBeBuff':e.get('CanBeBuff')=='1','canBeCurse':e.get('CanBeCurse')=='1','isAdvancedTrait':e.get('IsAdvancedTrait')=='1','buffRestrictions':[e[x] for x in sorted((x for x in e if re.fullmatch(r'BuffRestrictions\.\d+',x)),key=lambda x:int(x.split('.')[1]))],'curseRestrictions':[e[x] for x in sorted((x for x in e if re.fullmatch(r'CurseRestrictions\.\d+',x)),key=lambda x:int(x.split('.')[1]))],'damageType':e.get('Upgrades.0.Upgrade.DamageType'),'compatibilityTags':[e[x] for x in sorted((x for x in e if re.fullmatch(r'CompatibilityTags\.\d+',x)),key=lambda x:int(x.split('.')[1]))],'prefixTag':e.get('LocalizePrefixTag'),'suffixTag':e.get('LocalizeSuffixTag'),'upgradeValues':[{'value':float(e[x]),'locTag':e.get(x.replace('.Upgrade.Value','.Schema.LocTag'),''),'reverseValueSymbol':e.get(x.replace('.Upgrade.Value','.Schema.ReverseValueSymbol'))=='1'} for x in e if re.fullmatch(r'Upgrades\.\d+\.Upgrade\.Value',x)]} for e in es], 'compatibleItems':[e['ItemType'] for e in entries(k,'ItemCompatibilities') if e.get('Rarity') not in [None,'NONE']],'sentinelCompatibleItems':[e['ItemType'] for e in entries(k,'SentinelItemCompatibilities') if e.get('Rarity') not in [None,'NONE']], 'mergeOptions':[{'resultTag':x['ResultTag'],'primaryIngredient':x['PrimaryIngredient'],'secondaryIngredient':x['SecondaryIngredient']} for x in merges if x.get('ResultTag')]}
# Physical Riven traits (Impact/Puncture/Slash), per Riven-compatible weapon, most authoritative first:
# 1. warframe.market evidence (--market-evidence; repos/apps/metadata-editor/tools/riven-market-evidence): decided traits;
# 2. PE+ supplementals/riven_unrollables.json;
# 3. for weapons newer than that list (or not in PE+), the decoded-client rule (--weapon-rules; tools/riven-physical-rules).
# Anything else is unrestricted. rivenPhysicalRules lists the unrollable physical traits per weapon.
out['rivenPhysicalRules']={}
unroll=json.loads((pkg/'supplementals/riven_unrollables.json').read_text(encoding='utf-8'));pew=json.loads((pkg/'ExportWeapons.json').read_text(encoding='utf-8'))
newest=max(pew[w].get('introducedAt',0) for w in unroll if w in pew)
rules=json.loads(a.weapon_rules.read_text(encoding='utf-8')) if a.weapon_rules else {}
market=json.loads(a.market_evidence.read_text(encoding='utf-8'))['weapons'] if a.market_evidence else {}
for f in [a.weapon_rules,a.market_evidence]:
 if f:out['source']['files'][f.name]=hashlib.sha256(f.read_bytes()).hexdigest()
weapons=sorted({w for c in out['rivenContracts'].values() for w in c['compatibleItems']+c['sentinelCompatibleItems']})
for w in weapons:
 if w in unroll:blocked=set(unroll[w])
 elif (w not in pew or pew[w].get('introducedAt',0)>newest) and rules.get(w,{}).get('unrollablePhysical') is not None:blocked=set(rules[w]['unrollablePhysical'])
 else:blocked=set()
 m=market.get(w,{});blocked=(blocked|set(m.get('unrollable',[])))-set(m.get('rollable',[]))
 if blocked:out['rivenPhysicalRules'][w]=sorted(blocked)
output=a.server/'static/generated/openwf-metadata/current-public-export.json';output.write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8');print({k:len(v) for k,v in out['datasets'].items()},'rivenContracts',len(out['rivenContracts']))
