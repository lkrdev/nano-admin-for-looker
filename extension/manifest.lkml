project_name: "nano_admin"

application: admin_extension {
  label: "Nano Admin Extension"
  url: "https://storage.googleapis.com/arg-nano-admin-nano-admin-extension/bundle.js"
  
  entitlements: {
    use_embeds: no
    use_form_submit: yes
    local_storage: yes
    navigation: yes
    core_api_methods: ["me", "all_users", "user_roles"]
    scoped_user_attributes: ["nano_admin_challenge"]
    global_user_attributes: ["id"]
    external_api_urls: [
      "http://localhost:8081",
      "https://localhost:8081",
      "https://nano-admin-backend-3k5u7zcrka-nn.a.run.app",
      "https://storage.googleapis.com",
      "https://northamerica-northeast1-arg-nano-admin.cloudfunctions.net/nano-admin-backend",
      "https://northamerica-northeast1-arg-nano-admin.cloudfunctions.net"
    ]
  }
}
