// Contract confirmed using GET responses from the authorized Eccoa workspace.
// This file contains schema/field names only, never credentials or patient data.
export const RUGIDO_SCHEMA = {
  validated:true,
  workspace:{id:'data.id',name:'data.name'},
  stageNames:{},
  pipelines:{items:'data'},
  contacts:{items:'data',total:'meta.pagination.total',responsePage:'meta.pagination.page',id:'id',perPage:100,paginationMode:'until-empty',allowDuplicateIds:true,paidIdPath:'custom_attributes.ad_id'},
  conversations:{items:'data',total:'meta.total',responsePage:'meta.current_page',id:'id',contactId:'contact.id',perPage:100,paginationMode:'until-empty',params:{status:'all'}},
  messages:{items:'data',id:'id',paginationMode:'before-empty',orderTimestamp:'created_at',cursorParam:'before'},
  evidence:{id:'id',externalId:'source_id',contactId:'sender_id',direction:'message_type',incomingValue:'incoming',paidIdPath:'content_attributes.origem_anuncio.ad_id',adId:'content_attributes.origem_anuncio.ad_id',timestamp:'content_attributes.external_created_at',timestampUnit:'seconds',timestampFallback:'created_at',timestampFallbackUnit:'seconds'}
};
