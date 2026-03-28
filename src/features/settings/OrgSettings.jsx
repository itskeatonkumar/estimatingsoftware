import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase.js';
import { useOrg, canManageTeam, canManageBilling } from '../../lib/OrgContext.jsx';

const ROLES = ['owner','admin','editor','viewer'];
const ROLE_LABEL = {owner:'Owner',admin:'Admin',editor:'Editor',viewer:'Viewer'};
const ROLE_COLOR = {owner:'#7B6BA4',admin:'#1976D2',editor:'#10B981',viewer:'#6B7280'};

export default function OrgSettings({ user, onBack }) {
  const { orgId, orgs, userRole } = useOrg();
  const myRole = userRole;
  const [tab, setTab] = useState('team');
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('editor');
  const [inviteMsg, setInviteMsg] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [companyProfiles, setCompanyProfiles] = useState([]);
  const [editingProfile, setEditingProfile] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    // Load org
    supabase.from('organizations').select('*').eq('id', orgId).single()
      .then(({data}) => { if(data){setOrg(data);setOrgName(data.name||'');} }).catch(()=>{});
    // Load members
    supabase.from('memberships').select('user_id, role, created_at, profiles:user_id(id, email, full_name)')
      .eq('org_id', orgId).then(({data}) => { if(data) setMembers(data); }).catch(()=>{});
    // Load invites
    supabase.from('invitations').select('*').eq('org_id', orgId).is('accepted_at', null)
      .order('created_at',{ascending:false}).then(({data}) => setInvites(data||[])).catch(()=>{});
    // Load company profiles
    supabase.from('company_profiles').select('*').eq('org_id', orgId).order('is_default',{ascending:false})
      .then(({data}) => setCompanyProfiles(data||[])).catch(()=>{});
  }, [orgId, user?.id]);

  const isOwnerOrAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  const changeRole = async (userId, newRole) => {
    await supabase.from('memberships').update({role:newRole}).eq('org_id',orgId).eq('user_id',userId);
    setMembers(prev => prev.map(m => m.user_id===userId ? {...m,role:newRole} : m));
  };

  const removeMember = async (userId) => {
    if(!confirm('Remove this team member?')) return;
    await supabase.from('memberships').delete().eq('org_id',orgId).eq('user_id',userId);
    setMembers(prev => prev.filter(m => m.user_id!==userId));
  };

  const sendInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if(!email) return;
    setInviteMsg(null);
    const {error} = await supabase.from('invitations').insert([{
      org_id:orgId, email, role:inviteRole, invited_by:user?.id
    }]);
    if(error) { setInviteMsg({type:'error',text:error.message}); return; }
    setInviteMsg({type:'success',text:`Invite sent to ${email}`});
    setInviteEmail('');
    // Refresh invites
    const {data} = await supabase.from('invitations').select('*').eq('org_id',orgId).is('accepted_at',null).order('created_at',{ascending:false});
    setInvites(data||[]);
  };

  const cancelInvite = async (id) => {
    await supabase.from('invitations').delete().eq('id',id);
    setInvites(prev => prev.filter(i => i.id!==id));
  };

  const saveOrgName = async () => {
    if(!orgName.trim()) return;
    await supabase.from('organizations').update({name:orgName.trim()}).eq('id',orgId);
    setOrg(prev => ({...prev, name:orgName.trim()}));
    setEditingName(false);
  };

  const saveProfile = async (p) => {
    if(!p.name?.trim()){alert('Company name is required');return;}
    const row = {org_id:orgId, name:p.name.trim(), address:p.address?.trim()||null, city:p.city?.trim()||null,
      state:p.state?.trim()||null, zip:p.zip?.trim()||null, phone:p.phone?.trim()||null,
      email:p.email?.trim()||null, logo_url:p.logo_url||null, is_default:!!p.is_default};
    if(p.is_default) await supabase.from('company_profiles').update({is_default:false}).eq('org_id',orgId).eq('is_default',true);
    if(p.id){
      await supabase.from('company_profiles').update(row).eq('id',p.id);
      setCompanyProfiles(prev => prev.map(c => c.id===p.id ? {...c,...row} : p.is_default ? {...c,is_default:false} : c));
    } else {
      const {data} = await supabase.from('company_profiles').insert([row]).select().single();
      if(data) setCompanyProfiles(prev => [...prev.map(c => p.is_default ? {...c,is_default:false} : c), data]);
    }
    setEditingProfile(null);
  };

  const deleteProfile = async (id) => {
    if(!confirm('Delete this company profile?')) return;
    await supabase.from('company_profiles').delete().eq('id',id);
    setCompanyProfiles(prev => prev.filter(c => c.id!==id));
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
  const statusLabel = org?.subscription_status==='active'?'Active':org?.subscription_status==='trialing'?'Trialing':org?.subscription_status==='past_due'?'Past Due':org?.subscription_status==='canceled'?'Canceled':'Free';
  const statusColor = {active:'#10B981',trialing:'#E8A317',past_due:'#C0504D',canceled:'#6B7280'}[org?.subscription_status]||'#6B7280';

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'#F9FAFB',overflow:'hidden'}}>
      {/* Top bar */}
      <div style={{display:'flex',alignItems:'center',height:56,borderBottom:'1px solid #E5E7EB',background:'#fff',flexShrink:0,padding:'0 24px',gap:12}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'#6B7280',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',gap:6}}>
          &larr; Back to Projects
        </button>
        <div style={{flex:1}}/>
        <span style={{fontSize:12,color:'#9CA3AF'}}>{user?.email}</span>
      </div>

      <div style={{flex:1,overflow:'auto',padding:'24px 32px',maxWidth:860,margin:'0 auto',width:'100%',boxSizing:'border-box'}}>
        {/* Org name */}
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:24}}>
          {editingName ? (
            <input value={orgName} onChange={e=>setOrgName(e.target.value)}
              onBlur={saveOrgName} onKeyDown={e=>{if(e.key==='Enter')saveOrgName();if(e.key==='Escape')setEditingName(false);}}
              autoFocus style={{fontSize:22,fontWeight:700,color:'#1A1A1A',border:'1px solid #E5E7EB',borderRadius:6,padding:'4px 10px',outline:'none',width:320}}/>
          ) : (
            <h1 style={{fontSize:22,fontWeight:700,color:'#1A1A1A',margin:0}}>{org?.name || 'Organization'}</h1>
          )}
          {isOwnerOrAdmin && !editingName && (
            <button onClick={()=>setEditingName(true)} style={{background:'none',border:'none',color:'#9CA3AF',cursor:'pointer',fontSize:14}} title="Rename">&#9998;</button>
          )}
        </div>

        {/* Tabs */}
        <div style={{display:'flex',gap:0,borderBottom:'1px solid #E5E7EB',marginBottom:24}}>
          {[{id:'team',label:'Team'},{id:'company',label:'Company Profiles'},{id:'billing',label:'Billing'}].map(t=>(
            <button key={t.id} onClick={()=>{setTab(t.id);setEditingProfile(null);}}
              style={{padding:'10px 20px',border:'none',background:'none',cursor:'pointer',fontSize:13,fontWeight:tab===t.id?600:400,
                color:tab===t.id?'#10B981':'#6B7280',borderBottom:tab===t.id?'2px solid #10B981':'2px solid transparent'}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ═══ TEAM TAB ═══ */}
        {tab==='team'&&(
          <div>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
              <h2 style={{fontSize:16,fontWeight:600,color:'#1A1A1A',margin:0}}>Team Members</h2>
              <span style={{fontSize:12,color:'#9CA3AF',background:'#F3F4F6',padding:'2px 8px',borderRadius:10}}>{members.length}</span>
            </div>

            {/* Members table */}
            <div style={{background:'#fff',border:'1px solid #E5E7EB',borderRadius:8,overflow:'hidden',marginBottom:24}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{background:'#F9FAFB',borderBottom:'1px solid #E5E7EB'}}>
                    <th style={{textAlign:'left',padding:'10px 16px',fontWeight:600,color:'#6B7280',fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Name</th>
                    <th style={{textAlign:'left',padding:'10px 16px',fontWeight:600,color:'#6B7280',fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Email</th>
                    <th style={{textAlign:'left',padding:'10px 16px',fontWeight:600,color:'#6B7280',fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Role</th>
                    <th style={{textAlign:'left',padding:'10px 16px',fontWeight:600,color:'#6B7280',fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Joined</th>
                    <th style={{textAlign:'right',padding:'10px 16px',fontWeight:600,color:'#6B7280',fontSize:11,textTransform:'uppercase',letterSpacing:0.5}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => (
                    <tr key={m.user_id} style={{borderBottom:'1px solid #F3F4F6'}}>
                      <td style={{padding:'12px 16px',color:'#1A1A1A',fontWeight:500}}>{m.profiles?.full_name || '—'}</td>
                      <td style={{padding:'12px 16px',color:'#6B7280'}}>{m.profiles?.email || '—'}</td>
                      <td style={{padding:'12px 16px'}}>
                        {isOwner && m.role!=='owner' ? (
                          <select value={m.role} onChange={e=>changeRole(m.user_id,e.target.value)}
                            style={{padding:'4px 8px',border:'1px solid #E5E7EB',borderRadius:4,fontSize:12,color:ROLE_COLOR[m.role],background:'#fff',cursor:'pointer',outline:'none',fontWeight:500}}>
                            {ROLES.filter(r=>r!=='owner').map(r=><option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                        ) : (
                          <span style={{color:ROLE_COLOR[m.role],fontWeight:500,fontSize:12,background:ROLE_COLOR[m.role]+'15',padding:'3px 10px',borderRadius:10}}>{ROLE_LABEL[m.role]||m.role}</span>
                        )}
                      </td>
                      <td style={{padding:'12px 16px',color:'#9CA3AF',fontSize:12}}>{fmtDate(m.created_at)}</td>
                      <td style={{padding:'12px 16px',textAlign:'right'}}>
                        {isOwner && m.role!=='owner' && (
                          <button onClick={()=>removeMember(m.user_id)}
                            style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:11,fontWeight:500}}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Invite section */}
            {isOwnerOrAdmin && (
              <div style={{background:'#fff',border:'1px solid #E5E7EB',borderRadius:8,padding:20,marginBottom:24}}>
                <h3 style={{fontSize:14,fontWeight:600,color:'#1A1A1A',margin:'0 0 12px'}}>Invite Team Member</h3>
                <div style={{display:'flex',gap:8,alignItems:'center'}}>
                  <input value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="email@example.com"
                    onKeyDown={e=>{if(e.key==='Enter')sendInvite();}}
                    style={{flex:1,padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:6,fontSize:13,outline:'none',color:'#1A1A1A'}}/>
                  <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)}
                    style={{padding:'8px 12px',border:'1px solid #E5E7EB',borderRadius:6,fontSize:13,color:'#333',outline:'none',cursor:'pointer'}}>
                    {ROLES.filter(r=>r!=='owner').map(r=><option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <button onClick={sendInvite}
                    style={{background:'#10B981',border:'none',color:'#fff',padding:'8px 16px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:500,whiteSpace:'nowrap'}}>
                    Send Invite
                  </button>
                </div>
                {inviteMsg && (
                  <div style={{marginTop:8,fontSize:12,color:inviteMsg.type==='error'?'#EF4444':'#10B981'}}>{inviteMsg.text}</div>
                )}
                <div style={{fontSize:11,color:'#9CA3AF',marginTop:8}}>They'll join your organization when they create their account or accept the invite.</div>
              </div>
            )}

            {/* Pending invites */}
            {invites.length>0 && (
              <div style={{background:'#fff',border:'1px solid #E5E7EB',borderRadius:8,overflow:'hidden'}}>
                <div style={{padding:'12px 16px',borderBottom:'1px solid #E5E7EB',fontSize:13,fontWeight:600,color:'#1A1A1A'}}>
                  Pending Invites <span style={{color:'#9CA3AF',fontWeight:400}}>({invites.length})</span>
                </div>
                {invites.map(inv => (
                  <div key={inv.id} style={{display:'flex',alignItems:'center',padding:'10px 16px',borderBottom:'1px solid #F3F4F6',gap:12}}>
                    <span style={{flex:1,fontSize:13,color:'#1A1A1A'}}>{inv.email}</span>
                    <span style={{fontSize:11,color:ROLE_COLOR[inv.role],fontWeight:500}}>{ROLE_LABEL[inv.role]}</span>
                    <span style={{fontSize:11,color:'#9CA3AF'}}>{fmtDate(inv.created_at)}</span>
                    {isOwnerOrAdmin && (
                      <button onClick={()=>cancelInvite(inv.id)}
                        style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:11}}>Cancel</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ COMPANY PROFILES TAB ═══ */}
        {tab==='company'&&(
          <div>
            {editingProfile ? (()=>{
              const p = editingProfile;
              return (
                <div style={{background:'#fff',border:'1px solid #E5E7EB',borderRadius:8,padding:24}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:20}}>
                    <button onClick={()=>setEditingProfile(null)} style={{background:'none',border:'none',color:'#6B7280',cursor:'pointer',fontSize:14}}>&larr;</button>
                    <h3 style={{fontSize:16,fontWeight:600,color:'#1A1A1A',margin:0}}>{p.id?'Edit Company Profile':'New Company Profile'}</h3>
                  </div>
                  {/* Logo */}
                  <div style={{marginBottom:16}}>
                    <div style={{fontSize:12,color:'#6B7280',marginBottom:6}}>Company Logo</div>
                    <div style={{display:'flex',alignItems:'center',gap:12}}>
                      {p.logo_url ? (
                        <img src={p.logo_url} alt="" style={{width:150,height:60,objectFit:'contain',border:'1px solid #E5E7EB',borderRadius:4}}/>
                      ) : (
                        <div style={{width:150,height:60,border:'1px dashed #ccc',borderRadius:4,display:'flex',alignItems:'center',justifyContent:'center',color:'#9CA3AF',fontSize:11}}>No logo</div>
                      )}
                      <div style={{display:'flex',flexDirection:'column',gap:6}}>
                        <label style={{background:'#F3F4F6',border:'1px solid #E5E7EB',padding:'6px 12px',borderRadius:4,cursor:'pointer',fontSize:11,color:'#333',textAlign:'center'}}>
                          {logoUploading?'Uploading...':'Upload Logo'}
                          <input type="file" accept="image/png,image/jpeg,image/svg+xml" style={{display:'none'}} onChange={async(e)=>{
                            const file=e.target.files?.[0]; if(!file)return;
                            if(file.size>2*1024*1024){alert('Max 2MB');return;}
                            setLogoUploading(true);
                            const ext=file.name.split('.').pop();
                            const path=`${orgId}/${Date.now()}.${ext}`;
                            const {error}=await supabase.storage.from('logos').upload(path,file,{upsert:true});
                            if(error){alert('Upload failed: '+error.message);setLogoUploading(false);return;}
                            const {data:{publicUrl}}=supabase.storage.from('logos').getPublicUrl(path);
                            setEditingProfile(prev=>({...prev,logo_url:publicUrl}));
                            setLogoUploading(false);
                          }}/>
                        </label>
                        {p.logo_url&&<button onClick={()=>setEditingProfile(prev=>({...prev,logo_url:null}))} style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:11}}>Remove</button>}
                      </div>
                    </div>
                    <div style={{fontSize:10,color:'#9CA3AF',marginTop:4}}>PNG, JPG, or SVG. Max 2MB.</div>
                  </div>
                  {/* Fields */}
                  {[['name','Company Name *'],['address','Address'],['city','City'],['state','State'],['zip','ZIP'],['phone','Phone'],['email','Email']].map(([k,lbl])=>(
                    <div key={k} style={{marginBottom:10}}>
                      <div style={{fontSize:12,color:'#6B7280',marginBottom:4}}>{lbl}</div>
                      <input value={p[k]||''} onChange={e=>setEditingProfile(prev=>({...prev,[k]:e.target.value}))}
                        style={{width:'100%',border:'1px solid #E5E7EB',borderRadius:6,padding:'8px 12px',fontSize:13,color:'#1A1A1A',outline:'none',boxSizing:'border-box'}}/>
                    </div>
                  ))}
                  <label style={{display:'flex',alignItems:'center',gap:8,marginTop:12,cursor:'pointer'}}>
                    <input type="checkbox" checked={!!p.is_default} onChange={e=>setEditingProfile(prev=>({...prev,is_default:e.target.checked}))}/>
                    <span style={{fontSize:13,color:'#1A1A1A'}}>Set as default</span>
                  </label>
                  <div style={{display:'flex',gap:8,marginTop:20,justifyContent:'flex-end'}}>
                    <button onClick={()=>setEditingProfile(null)} style={{padding:'8px 16px',border:'1px solid #E5E7EB',background:'#fff',color:'#6B7280',borderRadius:6,cursor:'pointer',fontSize:12}}>Cancel</button>
                    <button onClick={()=>saveProfile(p)} style={{padding:'8px 16px',background:'#10B981',border:'none',color:'#fff',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:500}}>{p.id?'Save':'Create'}</button>
                  </div>
                </div>
              );
            })() : (
              <div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
                  <h2 style={{fontSize:16,fontWeight:600,color:'#1A1A1A',margin:0}}>Company Profiles</h2>
                  <button onClick={()=>setEditingProfile({})} style={{background:'#10B981',border:'none',color:'#fff',padding:'8px 16px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:500}}>+ Add Company</button>
                </div>
                {companyProfiles.length===0 && (
                  <div style={{textAlign:'center',padding:'40px 0',color:'#9CA3AF',fontSize:13}}>No company profiles yet. Add one to use on proposals.</div>
                )}
                {companyProfiles.map(cp => (
                  <div key={cp.id} style={{background:'#fff',border:'1px solid #E5E7EB',borderRadius:8,padding:16,marginBottom:12,display:'flex',alignItems:'center',gap:16}}>
                    {cp.logo_url ? (
                      <img src={cp.logo_url} alt="" style={{width:80,height:40,objectFit:'contain',borderRadius:4,flexShrink:0}}/>
                    ) : (
                      <div style={{width:40,height:40,borderRadius:'50%',background:'#10B981',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:16,flexShrink:0}}>{(cp.name||'?')[0]}</div>
                    )}
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:600,color:'#1A1A1A'}}>{cp.name}{cp.is_default&&<span style={{fontSize:10,color:'#10B981',marginLeft:8}}>Default</span>}</div>
                      <div style={{fontSize:12,color:'#9CA3AF',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{[cp.address,cp.city,cp.state].filter(Boolean).join(', ')}{cp.phone?` · ${cp.phone}`:''}</div>
                    </div>
                    <button onClick={()=>setEditingProfile({...cp})} style={{background:'#F3F4F6',border:'none',color:'#333',padding:'6px 12px',borderRadius:4,cursor:'pointer',fontSize:11}}>Edit</button>
                    <button onClick={()=>deleteProfile(cp.id)} style={{background:'none',border:'none',color:'#EF4444',cursor:'pointer',fontSize:11}}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ BILLING TAB ═══ */}
        {tab==='billing'&&(
          <div>
            <h2 style={{fontSize:16,fontWeight:600,color:'#1A1A1A',margin:'0 0 20px'}}>Billing</h2>
            <div style={{background:'#fff',border:'1px solid #E5E7EB',borderRadius:8,padding:24,marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
                <div style={{fontSize:18,fontWeight:700,color:'#1A1A1A'}}>ScopeTakeoff {org?.plan==='enterprise'?'Enterprise':org?.plan==='pro'?'Pro':'Free'}</div>
                <span style={{fontSize:11,fontWeight:600,color:statusColor,background:statusColor+'15',padding:'3px 10px',borderRadius:10}}>{statusLabel}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:20}}>
                <div style={{background:'#F9FAFB',borderRadius:6,padding:12}}>
                  <div style={{fontSize:11,color:'#9CA3AF',marginBottom:4}}>Seats</div>
                  <div style={{fontSize:18,fontWeight:600,color:'#1A1A1A'}}>{members.length} <span style={{fontSize:12,fontWeight:400,color:'#9CA3AF'}}>/ {org?.max_members||1}</span></div>
                </div>
                <div style={{background:'#F9FAFB',borderRadius:6,padding:12}}>
                  <div style={{fontSize:11,color:'#9CA3AF',marginBottom:4}}>Projects</div>
                  <div style={{fontSize:18,fontWeight:600,color:'#1A1A1A'}}>— <span style={{fontSize:12,fontWeight:400,color:'#9CA3AF'}}>/ {org?.max_projects||2}</span></div>
                </div>
                <div style={{background:'#F9FAFB',borderRadius:6,padding:12}}>
                  <div style={{fontSize:11,color:'#9CA3AF',marginBottom:4}}>Sheets / Project</div>
                  <div style={{fontSize:18,fontWeight:600,color:'#1A1A1A'}}>— <span style={{fontSize:12,fontWeight:400,color:'#9CA3AF'}}>/ {org?.max_sheets_per_project||10}</span></div>
                </div>
              </div>
              {org?.subscription_status==='trialing' && org?.trial_ends_at && (
                <div style={{fontSize:13,color:'#E8A317',marginBottom:16}}>
                  Trial ends: <strong>{fmtDate(org.trial_ends_at)}</strong>
                </div>
              )}
              {canManageBilling(myRole) && <div style={{display:'flex',gap:8}}>
                {org?.stripe_customer_id ? (
                  <button onClick={async()=>{
                    const res=await fetch('/api/create-portal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customer_id:org.stripe_customer_id,return_url:window.location.href})});
                    const {url}=await res.json();
                    if(url)window.location.href=url;
                  }} style={{background:'#10B981',border:'none',color:'#fff',padding:'10px 20px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:500}}>
                    Manage Billing
                  </button>
                ) : (
                  <button onClick={async()=>{
                    const res=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seats:members.length||1,success_url:window.location.origin+'/#/',cancel_url:window.location.href})});
                    const {url}=await res.json();
                    if(url)window.location.href=url;
                  }} style={{background:'#10B981',border:'none',color:'#fff',padding:'10px 20px',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:500}}>
                    Subscribe
                  </button>
                )}
              </div>}
              {!canManageBilling(myRole) && <div style={{fontSize:12,color:'#9CA3AF'}}>Only the organization owner can manage billing.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
