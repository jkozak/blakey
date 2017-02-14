#!/bin/bash

set -e

tmp=$(mktemp -d)
vagrant up
function cleanup {
    rm -rf $tmp
    vagrant halt
}
trap cleanup EXIT

key=$(pwd)/.vagrant/machines/default/virtualbox/private_key

(tar caf - --no-recursion ../* ../test/*) | vagrant ssh -c "tar xaf -"
cat ~/.npmrc | vagrant ssh -c "cat > .npmrc"
vagrant ssh -c "sed -i '/prefix=/d' .npmrc"

vagrant ssh -c "npm install"

vagrant ssh -c "npm test"

vagrant ssh -c "sudo bash -" <<EOF

(cd ~vagrant;npm install -g)

rm   -rf /var/local/deploy/test 2>/dev/null
mkdir -p /var/local/deploy/test 2>/dev/null
chgrp vagrant /var/local/deploy/test
chmod g+w     /var/local/deploy/test

(cd /var/local/deploy/test;rm -rf *;deployer init)

EOF

# now make a repo with a test service on the host

pushd $tmp

git init

cat >deploy-test.sh <<EOF
#!/bin/bash
while true
do
        echo -n 1 > /tmp/srv.txt
        sleep 0.1
done
EOF

cat >deploy-test.service <<EOF
[Unit]
Description=Test service for deployer
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=vagrant
Group=vagrant
WorkingDirectory=/var/local/deploy/test/current/work/
ExecStart=/bin/bash deploy-test.sh
StandardOutput=syslog
StandardError=syslog

[Install]
WantedBy=multi-user.target
EOF

git add .
git commit -m "init"
git remote add deploy ssh://vagrant@localhost:2222//var/local/deploy/test/repo.git
ssh-agent bash -c "ssh-add $key; git push deploy master"

popd

vagrant ssh -c "sudo systemctl enable /var/local/deploy/test/current/work/deploy-test.service"
vagrant ssh -c "sudo systemctl start deploy-test.service"
sleep 1
srv_txt=$(vagrant ssh -c 'cat /tmp/srv.txt')
[[ "$srv_txt" = "1" ]] || (echo "expected to read 1, got $srv_txt.";exit 1)

# now change the 1 to 2 in the service, and push the change.
pushd $tmp

sed -i 's/echo -n 1/echo -n 2/' deploy-test.sh
git add .
git commit -m 1
ssh-agent bash -c "ssh-add $key; git push deploy master"

popd

sleep 1
srv_txt=$(vagrant ssh -c 'cat /tmp/srv.txt')
[[ "$srv_txt" = "2" ]] || (echo "expected to read 2, got $srv_txt.";exit 1)

# now change the 2 to 3 in the service, and push the change.
pushd $tmp

sed -i 's/echo -n 2/echo -n 3/' deploy-test.sh
git add .
git commit -m 2
ssh-agent bash -c "ssh-add $key; git push deploy master"

popd

sleep 1
srv_txt=$(vagrant ssh -c 'cat /tmp/srv.txt')
[[ "$srv_txt" = "3" ]] || (echo "expected to read 3, got $srv_txt.";exit 1)
